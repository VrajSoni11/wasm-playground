// A single lexical scope: maps names -> symbol info ({ kind, type, ... }).
// Scopes are chained via `parent` to support nested block scoping.
class Scope {
  constructor(parent = null) {
    this.parent = parent;
    this.symbols = new Map();
  }

  // Declare a new symbol in *this* scope. Returns false if already declared
  // in this exact scope (shadowing an outer scope is fine; redeclaring in
  // the same scope is an error the caller should report).
  declare(name, info) {
    if (this.symbols.has(name)) return false;
    this.symbols.set(name, info);
    return true;
  }

  // Look up a symbol, walking up the scope chain.
  resolve(name) {
    let scope = this;
    while (scope) {
      if (scope.symbols.has(name)) return scope.symbols.get(name);
      scope = scope.parent;
    }
    return null;
  }
}

module.exports = { Scope };
