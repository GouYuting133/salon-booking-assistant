const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const minute = 60_000;
const sessionLifetime = 30 * 24 * 60 * minute;
const error = (message, status) => Object.assign(Error(message), { status });

module.exports = function customerAccounts({ sql, hash, transaction, createProfile, profileExists, claimProfile }) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS customer_accounts (
      username TEXT PRIMARY KEY, customerId TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL, passwordHash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_sessions (
      hash TEXT PRIMARY KEY, customerId TEXT NOT NULL, expires INTEGER NOT NULL
    );
  `);
  const lookup = sql.prepare('SELECT * FROM customer_accounts WHERE username=?');
  const attempts = new Map();
  let windowEnd = 0;
  let requests = 0;
  let active = 0;
  let lastPruned = 0;
  const dummySalt = crypto.randomBytes(16).toString('hex');

  async function authenticate(data, register) {
    const username = typeof data?.username === 'string' ? data.username.trim().toLowerCase() : '';
    const password = data?.password;
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    const validUsername = register ? /^1[3-9]\d{9}$/.test(username) : /^[a-z0-9_]{4,24}$/.test(username);
    if (!validUsername ||
        typeof password !== 'string' || password.length < 8 || password.length > 128) {
      throw error(register ? '请输入有效的11位中国大陆手机号，密码须为8至128个字符' : '手机号、原账号或密码不正确', register ? 400 : 401);
    }
    if (register && name.length > 40) throw error('称呼不能超过40字', 400);

    const now = Date.now();
    if (now >= windowEnd) {
      windowEnd = now + minute;
      requests = 0;
      attempts.clear();
    }
    const count = attempts.get(username) || 0;
    if (count >= 10 || requests >= 120 || active >= 4) throw error('操作太频繁，请稍后重试', 429);
    attempts.set(username, count + 1);
    requests++;
    active++;
    try {
      const account = lookup.get(username);
      const salt = register ? crypto.randomBytes(16).toString('hex') : account?.salt || dummySalt;
      const derived = await scrypt(password, salt, 32);
      if (register) {
        return transaction(() => {
          if (lookup.get(username)) throw error('该账号已被使用，请登录或更换账号', 409);
          const customerId = data.claim ? claimProfile(data.claim, username) : createProfile(name, username);
          sql.prepare('INSERT INTO customer_accounts VALUES(?,?,?,?)').run(username, customerId, salt, derived.toString('hex'));
          return issueSession(customerId);
        });
      }
      const matches = crypto.timingSafeEqual(derived, account ? Buffer.from(account.passwordHash, 'hex') : Buffer.alloc(32));
      if (!account || !matches || lookup.get(username)?.passwordHash !== account.passwordHash || !profileExists(account.customerId)) throw error('账号或密码不正确', 401);
      return issueSession(account.customerId);
    } finally {
      active--;
    }
  }

  function issueSession(customerId) {
    const now = Date.now();
    if (now - lastPruned >= minute) {
      sql.prepare('DELETE FROM customer_sessions WHERE expires<=?').run(now);
      lastPruned = now;
    }
    const token = crypto.randomBytes(32).toString('base64url');
    sql.prepare('INSERT INTO customer_sessions VALUES(?,?,?)').run(hash(token), customerId, now + sessionLifetime);
    return { token };
  }

  return {
    authenticate,
    customerId(tokenHash) {
      return sql.prepare('SELECT customerId FROM customer_sessions WHERE hash=? AND expires>?').get(tokenHash, Date.now())?.customerId;
    },
    renew(tokenHash) {
      const now = Date.now();
      sql.prepare('UPDATE customer_sessions SET expires=? WHERE hash=? AND expires>?').run(now + sessionLifetime, tokenHash, now);
    },
    logout(tokenHash) {
      sql.prepare('DELETE FROM customer_sessions WHERE hash=?').run(tokenHash);
    }
  };
};
