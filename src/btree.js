'use strict';
/**
 * B+ Tree simulation (Experiment 11).
 *
 * A B+ tree of order 4 (at most 3 keys per node) is built over the account
 * numbers. All data lives in the leaves, which are linked together, and the
 * internal nodes hold only separator keys - the reason a B+ tree answers a
 * range scan of an account statement with a single descent followed by a walk
 * along the leaf chain, which is exactly how the planner uses
 * idx_txn_account_time.
 */

const ORDER = 4;
const MAX_KEYS = ORDER - 1;

class BPlusTree {
  constructor() {
    this.root = { leaf: true, keys: [], children: [] };
  }

  _newLeaf() {
    return { leaf: true, keys: [], children: [] };
  }

  _newInternal() {
    return { leaf: false, keys: [], children: [] };
  }

  /** Insert or update one key. Returns true when a new key was added. */
  insert(key, value) {
    const promoted = this._insert(this.root, key, value);
    if (promoted) {
      const root = this._newInternal();
      root.keys = [promoted.key];
      root.children = [this.root, promoted.node];
      this.root = root;
    }
    return true;
  }

  _insert(node, key, value) {
    if (node.leaf) {
      let i = 0;
      while (i < node.keys.length && node.keys[i].key < key) i += 1;
      if (node.keys[i] && node.keys[i].key === key) {
        node.keys[i].value = value; // duplicate key: update in place
        return null;
      }
      node.keys.splice(i, 0, { key, value });
      if (node.keys.length > MAX_KEYS) {
        const mid = Math.ceil(node.keys.length / 2);
        const right = this._newLeaf();
        right.keys = node.keys.splice(mid);
        return { key: right.keys[0].key, node: right };
      }
      return null;
    }

    let i = 0;
    while (i < node.keys.length && key >= node.keys[i]) i += 1;
    const promoted = this._insert(node.children[i], key, value);
    if (!promoted) return null;

    node.keys.splice(i, 0, promoted.key);
    node.children.splice(i + 1, 0, promoted.node);

    if (node.keys.length > MAX_KEYS) {
      const mid = Math.floor(node.keys.length / 2);
      const upKey = node.keys[mid];
      const right = this._newInternal();
      right.keys = node.keys.slice(mid + 1);
      right.children = node.children.slice(mid + 1);
      node.keys = node.keys.slice(0, mid);
      node.children = node.children.slice(0, mid + 1);
      return { key: upKey, node: right };
    }
    return null;
  }

  /** Descend from the root to the leaf that would hold `key`. */
  search(key) {
    let node = this.root;
    const path = [];
    while (!node.leaf) {
      let i = 0;
      while (i < node.keys.length && key >= node.keys[i]) i += 1;
      path.push({ keys: node.keys.slice(), child: i });
      node = node.children[i];
    }
    const found = node.keys.find((e) => e.key === key) || null;
    return { found: Boolean(found), value: found ? found.value : null, path, leafKeys: node.keys.map((e) => e.key) };
  }

  leaves() {
    let node = this.root;
    while (!node.leaf) node = node.children[0];
    const out = [];
    while (node) {
      out.push(node.keys.map((e) => e.key));
      node = node.next;
    }
    return out;
  }

  /** Level-by-level snapshot used by the UI. */
  levels() {
    const levels = [];
    let current = [this.root];
    let height = 1;
    while (current.length) {
      levels.push(
        current.map((node) => ({
          keys: node.keys.map((e) => (e.key === undefined ? e : e.key)),
          leaf: node.leaf,
        }))
      );
      const next = [];
      for (const node of current) if (!node.leaf) next.push(...node.children);
      if (!next.length) break;
      current = next;
      height += 1;
    }
    return { levels, height };
  }

  stats() {
    let nodes = 0;
    let entries = 0;
    const walk = (node) => {
      nodes += 1;
      if (node.leaf) entries += node.keys.length;
      else node.children.forEach(walk);
    };
    walk(this.root);
    return { order: ORDER, height: this.levels().height, nodes, entries };
  }
}

/** Keep the leaf chain linked so that range scans are possible. */
function relinkLeaves(tree) {
  const collect = (node) => (node.leaf ? [node] : node.children.flatMap(collect));
  const leaves = collect(tree.root);
  leaves.forEach((leaf, i) => {
    leaf.next = leaves[i + 1] || null;
  });
}

function build(keys) {
  const tree = new BPlusTree();
  for (const key of keys) tree.insert(Number(key));
  relinkLeaves(tree);
  return tree;
}

function insert(tree, key) {
  tree.insert(Number(key));
  relinkLeaves(tree);
  return tree;
}

module.exports = { BPlusTree, build, insert, relinkLeaves, ORDER };
