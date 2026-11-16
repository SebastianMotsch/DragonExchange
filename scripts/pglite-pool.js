// Only used by local demos/tests. Serialize access to PGlite's single connection.
module.exports = function pglitePool(db) {
  let tail = Promise.resolve();
  async function acquire() {
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const previous = tail;
    tail = held;
    await previous;
    return release;
  }
  return {
    async query(sql, values) {
      const release = await acquire();
      try {
        return await db.query(sql, values);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await acquire();
      return { query: (sql, values) => db.query(sql, values), release };
    },
  };
};
