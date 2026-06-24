/**
 * sqliteAdapter.mjs — sql.js 适配器，模拟 better-sqlite3 的同步 API
 *
 * 🎭 为什么需要这个？
 * better-sqlite3 是 C++ 原生模块，需要编译，在 Node.js v24 上编译失败。
 * sql.js 是纯 JS（WASM）实现，零编译问题，但 API 是异步的。
 * 这个适配器把 sql.js 包装成 better-sqlite3 的同步 API，让其他代码不用改。
 *
 * 📌 支持的 API（覆盖项目实际使用的）：
 * - db.prepare(sql).run(...params) → { changes, lastInsertRowid }
 * - db.prepare(sql).run({ named: params }) → 命名参数支持
 * - db.prepare(sql).get(...params) → object | undefined
 * - db.prepare(sql).all(...params) → array
 * - db.exec(sql)
 * - db.pragma(sql)
 * - db.transaction(fn) → 包装函数，自动 BEGIN/COMMIT/ROLLBACK
 * - db.close()
 */

import initSqlJs from "sql.js";
import fs from "node:fs";
import path from "node:path";

let sqlJsReady = null;

/**
 * 初始化 sql.js WASM 引擎
 * 🏭 只初始化一次，后续复用
 *
 * @returns {Promise<SqlJsStatic>}
 */
async function getSqlJs() {
  if (!sqlJsReady) {
    sqlJsReady = initSqlJs();
  }
  return sqlJsReady;
}

/**
 * 从 SQL 语句中提取命名参数及其前缀
 * 🔍 扫描 SQL 找出所有 @name / :name / $name 形式的参数
 *
 * 比如 "VALUES (@id, @name)" → 返回 Map { 'id' → '@id', 'name' → '@name' }
 *
 * @param {string} sql - SQL 语句
 * @returns {Map<string, string>} 键是不带前缀的参数名，值是带前缀的完整参数名
 */
function extractNamedParams(sql) {
  const params = new Map();
  const regex = /([@:$])(\w+)/g;
  let match;
  while ((match = regex.exec(sql)) !== null) {
    const prefix = match[1];
    const name = match[2];
    if (!params.has(name)) {
      params.set(name, prefix + name);
    }
  }
  return params;
}

/**
 * 把 better-sqlite3 风格的命名参数对象转成 sql.js 风格
 * 🔄 better-sqlite3 用 { name: value }（不带前缀）
 *    sql.js 用 { '@name': value }（带前缀）
 *
 * @param {object} obj - better-sqlite3 风格的参数对象
 * @param {Map<string, string>} paramMap - 从 SQL 提取的参数映射
 * @returns {object} sql.js 风格的参数对象
 */
function convertNamedParams(obj, paramMap) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (paramMap.has(key)) {
      result[paramMap.get(key)] = value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 同步包装器：把 sql.js 的异步操作包装成同步
 * 🔧 核心技巧：在模块加载时初始化 sql.js，之后所有操作都是同步的
 * 因为 sql.js 的 Database 实例一旦创建，exec/prepare 都是同步的
 */
class SyncDatabase {
  constructor(dbPath) {
    this._dbPath = dbPath;
    this._db = null;
    this._initialized = false;
    this._inTransaction = false;
  }

  /**
   * 异步初始化（只在创建数据库时调用一次）
   * 🚀 加载 WASM + 读取磁盘文件（如果存在）
   */
  async init() {
    const SQL = await getSqlJs();

    if (fs.existsSync(this._dbPath)) {
      const buffer = fs.readFileSync(this._dbPath);
      this._db = new SQL.Database(buffer);
    } else {
      this._db = new SQL.Database();
    }

    const dir = path.dirname(this._dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this._initialized = true;
    return this;
  }

  /**
   * 保存数据库到磁盘
   * 💾 sql.js 是内存数据库，需要手动持久化
   * 事务内不持久化，等事务提交后再统一持久化，避免 export() 干扰事务状态
   */
  _persist() {
    if (this._inTransaction) return;
    try {
      const data = this._db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this._dbPath, buffer);
    } catch (err) {
      console.error("[sqliteAdapter] 持久化失败:", err.message);
    }
  }

  /**
   * 执行 SQL 语句（无返回值）
   * 和 better-sqlite3 的 db.exec() 一样
   *
   * @param {string} sql - SQL 语句
   */
  exec(sql) {
    this._db.run(sql);
    this._persist();
  }

  /**
   * 执行 PRAGMA 语句
   * 📋 返回结果数组，模拟 better-sqlite3 的 db.pragma()
   *
   * @param {string} sql - PRAGMA 语句（如 "journal_mode = WAL"）
   * @returns {Array<object>}
   */
  pragma(sql) {
    const pragmaSql = sql.startsWith("PRAGMA") ? sql : `PRAGMA ${sql}`;
    try {
      const stmt = this._db.prepare(pragmaSql);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch {
      return [];
    }
  }

  /**
   * 创建预处理语句
   * 📝 和 better-sqlite3 的 db.prepare() 一样，返回的对象有 run/get/all 方法
   *
   * @param {string} sql - SQL 语句（可以包含 ? 或 @name 占位符）
   * @returns {SyncStatement}
   */
  prepare(sql) {
    return new SyncStatement(this, sql);
  }

  /**
   * 创建事务函数
   * 🔒 和 better-sqlite3 的 db.transaction(fn) 一样
   * 自动包裹 BEGIN / COMMIT / ROLLBACK，出错自动回滚
   *
   * 💡 事务内的 run() 调用不会触发 _persist()，等 COMMIT 后统一持久化，
   *    避免 sql.js 的 export() 在事务中途破坏事务状态
   *
   * 用法：
   *   const insertMany = db.transaction((items) => {
   *     for (const item of items) {
   *       stmt.run(item)
   *     }
   *   })
   *   insertMany([{ id: 1 }, { id: 2 }])  // 自动开事务
   *
   * @param {Function} fn - 要包裹在事务里的函数
   * @returns {Function} 包裹后的函数，调用时自动开事务
   */
  transaction(fn) {
    const self = this;
    return function (...args) {
      self._inTransaction = true;
      self._db.run("BEGIN TRANSACTION");
      try {
        const result = fn.apply(this, args);
        self._db.run("COMMIT");
        self._inTransaction = false;
        self._persist();
        return result;
      } catch (err) {
        self._inTransaction = false;
        try {
          self._db.run("ROLLBACK");
        } catch (rollbackErr) {
          console.error("[sqliteAdapter] ROLLBACK 失败:", rollbackErr.message);
        }
        self._persist();
        throw err;
      }
    };
  }

  /**
   * 关闭数据库
   * 🔒 关闭前自动保存
   */
  close() {
    if (this._db) {
      this._persist();
      this._db.close();
      this._db = null;
    }
  }
}

/**
 * 同步预处理语句
 * 📝 包装 sql.js 的 stmt，提供 run/get/all 方法
 * 支持 better-sqlite3 的两种参数风格：
 *   - 位置参数：stmt.run(1, "hello")
 *   - 命名参数：stmt.run({ id: 1, name: "hello" })
 */
class SyncStatement {
  constructor(db, sql) {
    this._db = db;
    this._sql = sql;
    this._namedParams = extractNamedParams(sql);
  }

  /**
   * 把用户传入的参数转成 sql.js 能识别的绑定格式
   * 🔄 如果是命名参数对象 { name: value }，转成 { '@name': value }
   *   如果是位置参数数组，直接返回
   *
   * @param {Array} params - 用户传入的参数列表
   * @returns {Array|object} sql.js 能识别的绑定格式
   */
  _normalizeParams(params) {
    if (params.length === 0) return null;
    if (params.length === 1 && params[0] !== null && typeof params[0] === "object" && !Array.isArray(params[0])) {
      if (this._namedParams.size > 0) {
        return convertNamedParams(params[0], this._namedParams);
      }
      return params[0];
    }
    return params;
  }

  /**
   * 执行写操作（INSERT/UPDATE/DELETE）
   * 💾 非事务模式下执行后自动持久化；事务模式下等 COMMIT 后统一持久化
   *
   * @param  {...any} params - 绑定参数（位置参数或命名参数对象）
   * @returns {{ changes: number, lastInsertRowid: number }}
   */
  run(...params) {
    const stmt = this._db._db.prepare(this._sql);
    const bindParams = this._normalizeParams(params);
    if (bindParams !== null) {
      stmt.bind(bindParams);
    }
    stmt.step();
    const changes = this._db._db.getRowsModified();
    const lastInsertRowid = Number(
      this._db._db.exec("SELECT last_insert_rowid() as id")[0]?.values?.[0]?.[0] || 0
    );
    stmt.free();
    this._db._persist();
    return { changes, lastInsertRowid };
  }

  /**
   * 查询单行
   * 🔍 返回第一行结果，没有则返回 undefined
   *
   * @param  {...any} params - 绑定参数（位置参数或命名参数对象）
   * @returns {object|undefined}
   */
  get(...params) {
    const stmt = this._db._db.prepare(this._sql);
    const bindParams = this._normalizeParams(params);
    if (bindParams !== null) {
      stmt.bind(bindParams);
    }
    let result = undefined;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  }

  /**
   * 查询所有行
   * 📋 返回所有结果的数组
   *
   * @param  {...any} params - 绑定参数（位置参数或命名参数对象）
   * @returns {Array<object>}
   */
  all(...params) {
    const stmt = this._db._db.prepare(this._sql);
    const bindParams = this._normalizeParams(params);
    if (bindParams !== null) {
      stmt.bind(bindParams);
    }
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }
}

/**
 * 创建数据库连接（异步版）
 * 🚀 替代 new Database(dbPath)，因为 sql.js 需要先加载 WASM
 *
 * @param {string} dbPath - 数据库文件路径
 * @returns {Promise<SyncDatabase>}
 */
export async function createDatabase(dbPath) {
  const db = new SyncDatabase(dbPath);
  await db.init();
  return db;
}
