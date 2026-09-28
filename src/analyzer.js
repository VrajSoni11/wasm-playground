const { Scope } = require("./scope");

class SemanticError extends Error {
  constructor(message, line) {
    super(`Semantic error [line ${line ?? "?"}]: ${message}`);
    this.line = line;
  }
}

// Valid value types in our language. 'void' is only valid as a function
// return type (meaning "no return value").
const VALUE_TYPES = new Set(["int", "float", "bool"]);

class Analyzer {
  constructor() {
    this.globalScope = new Scope();
    this.functions = new Map(); // name -> { params: [type,...], returnType }
    this.currentFunction = null; // { name, returnType } while inside a function body
  }

  // Public entry point. Mutates `program`'s AST in place (adding
  // `resolvedType` fields) and throws SemanticError on the first problem
  // found. Returns the function table, which codegen also needs.
  analyze(program) {
    // Pass 1: register all function signatures first, so functions can
    // call each other regardless of declaration order (incl. recursion
    // and mutual recursion).
    for (const decl of program.declarations) {
      if (decl.type === "FuncDecl") {
        if (this.functions.has(decl.name)) {
          throw new SemanticError(`Function '${decl.name}' is already declared`, decl.line);
        }
        const paramTypes = decl.params.map((p) => p.paramType);
        const returnType = decl.returnType || "void";
        this.functions.set(decl.name, { paramTypes, returnType, node: decl });
      }
    }

    // Pass 2: check global var decls and function bodies.
    for (const decl of program.declarations) {
      if (decl.type === "FuncDecl") {
        this.checkFunction(decl);
      } else if (decl.type === "VarDecl") {
        this.checkVarDecl(decl, this.globalScope);
      } else {
        this.checkStatement(decl, this.globalScope);
      }
    }

    return this.functions;
  }

  // ---------------- declarations ----------------
  checkFunction(fn) {
    const scope = new Scope(this.globalScope);
    for (const param of fn.params) {
      if (!VALUE_TYPES.has(param.paramType)) {
        throw new SemanticError(`Invalid parameter type '${param.paramType}'`, fn.line);
      }
      scope.declare(param.name, { kind: "param", type: param.paramType });
    }

    const returnType = fn.returnType || "void";
    if (returnType !== "void" && !VALUE_TYPES.has(returnType)) {
      throw new SemanticError(`Invalid return type '${returnType}'`, fn.line);
    }

    const prevFunction = this.currentFunction;
    this.currentFunction = { name: fn.name, returnType };
    this.checkBlock(fn.body, scope);
    this.currentFunction = prevFunction;

    if (returnType !== "void" && !this.allPathsReturn(fn.body)) {
      throw new SemanticError(
        `Function '${fn.name}' must return a value of type '${returnType}' on all code paths`,
        fn.line
      );
    }
  }

  // Conservative reachability check: does every path through this block
  // definitely hit a `return`? Used to guarantee non-void functions can't
  // fall off the end (which would trap at runtime in the compiled WASM).
  allPathsReturn(block) {
    for (const stmt of block.statements) {
      if (stmt.type === "ReturnStmt") return true;
      if (stmt.type === "IfStmt" && stmt.elseBranch) {
        const thenReturns = this.allPathsReturn(stmt.thenBranch);
        const elseReturns =
          stmt.elseBranch.type === "IfStmt"
            ? this.allPathsReturnIf(stmt.elseBranch)
            : this.allPathsReturn(stmt.elseBranch);
        if (thenReturns && elseReturns) return true;
      }
      // while/if-without-else/etc. can't be statically guaranteed to run,
      // so they don't count as "definitely returns" on their own.
    }
    return false;
  }

  allPathsReturnIf(ifStmt) {
    if (!ifStmt.elseBranch) return false;
    const thenReturns = this.allPathsReturn(ifStmt.thenBranch);
    const elseReturns =
      ifStmt.elseBranch.type === "IfStmt"
        ? this.allPathsReturnIf(ifStmt.elseBranch)
        : this.allPathsReturn(ifStmt.elseBranch);
    return thenReturns && elseReturns;
  }

  checkVarDecl(decl, scope) {
    const initType = this.checkExpr(decl.initializer, scope);

    if (decl.varType) {
      if (!VALUE_TYPES.has(decl.varType)) {
        throw new SemanticError(`Invalid type '${decl.varType}'`, decl.line);
      }
      if (decl.varType !== initType) {
        throw new SemanticError(
          `Cannot assign value of type '${initType}' to variable '${decl.name}' of type '${decl.varType}'`,
          decl.line
        );
      }
    } else {
      decl.varType = initType; // type inferred from initializer
    }

    if (!scope.declare(decl.name, { kind: "var", type: decl.varType })) {
      throw new SemanticError(`Variable '${decl.name}' is already declared in this scope`, decl.line);
    }
    decl.resolvedType = decl.varType;
  }

  // ---------------- statements ----------------
  checkStatement(stmt, scope) {
    switch (stmt.type) {
      case "VarDecl":
        return this.checkVarDecl(stmt, scope);
      case "ExprStmt":
        // A bare expression statement is the one place a void function call
        // is legal, since its (non-existent) result isn't used as a value.
        if (stmt.expression.type === "Call") {
          this.checkCallExpr(stmt.expression, scope, /* allowVoid */ true);
        } else {
          this.checkExpr(stmt.expression, scope);
        }
        return;
      case "PrintStmt":
        this.checkExpr(stmt.expression, scope);
        return;
      case "IfStmt": {
        const condType = this.checkExpr(stmt.condition, scope);
        if (condType !== "bool") {
          throw new SemanticError(`'if' condition must be bool, got '${condType}'`, stmt.line);
        }
        this.checkBlock(stmt.thenBranch, new Scope(scope));
        if (stmt.elseBranch) {
          // elseBranch is either a Block or (for "else if") another IfStmt
          if (stmt.elseBranch.type === "IfStmt") {
            this.checkStatement(stmt.elseBranch, scope);
          } else {
            this.checkBlock(stmt.elseBranch, new Scope(scope));
          }
        }
        return;
      }
      case "WhileStmt": {
        const condType = this.checkExpr(stmt.condition, scope);
        if (condType !== "bool") {
          throw new SemanticError(`'while' condition must be bool, got '${condType}'`, stmt.line);
        }
        this.checkBlock(stmt.body, new Scope(scope));
        return;
      }
      case "ReturnStmt": {
        if (!this.currentFunction) {
          throw new SemanticError(`'return' used outside of a function`, stmt.line);
        }
        const expected = this.currentFunction.returnType;
        if (stmt.value === null) {
          if (expected !== "void") {
            throw new SemanticError(
              `Function '${this.currentFunction.name}' must return a value of type '${expected}'`,
              stmt.line
            );
          }
        } else {
          const actual = this.checkExpr(stmt.value, scope);
          if (expected === "void") {
            throw new SemanticError(
              `Function '${this.currentFunction.name}' has no return type but 'return' has a value`,
              stmt.line
            );
          }
          if (actual !== expected) {
            throw new SemanticError(
              `Function '${this.currentFunction.name}' returns '${expected}' but got '${actual}'`,
              stmt.line
            );
          }
        }
        return;
      }
      case "Block":
        return this.checkBlock(stmt, new Scope(scope));
      default:
        throw new SemanticError(`Unknown statement type '${stmt.type}'`, stmt.line);
    }
  }

  checkBlock(block, scope) {
    for (const stmt of block.statements) {
      this.checkStatement(stmt, scope);
    }
  }

  // ---------------- expressions ----------------
  // Returns the resolved type ('int' | 'float' | 'bool') and also stashes
  // it on the node as `resolvedType` for the codegen phase to consume.
  checkExpr(expr, scope) {
    let t;
    switch (expr.type) {
      case "NumberLit":
        t = expr.isFloat ? "float" : "int";
        break;

      case "BoolLit":
        t = "bool";
        break;

      case "Variable": {
        const sym = scope.resolve(expr.name);
        if (!sym) {
          throw new SemanticError(`Undeclared variable '${expr.name}'`, expr.line);
        }
        t = sym.type;
        break;
      }

      case "Assign": {
        const sym = scope.resolve(expr.name);
        if (!sym) {
          throw new SemanticError(`Undeclared variable '${expr.name}'`, expr.line);
        }
        const valueType = this.checkExpr(expr.value, scope);
        if (valueType !== sym.type) {
          throw new SemanticError(
            `Cannot assign '${valueType}' to variable '${expr.name}' of type '${sym.type}'`,
            expr.line
          );
        }
        t = sym.type;
        break;
      }

      case "Unary": {
        const operandType = this.checkExpr(expr.operand, scope);
        if (expr.op === "-") {
          if (operandType !== "int" && operandType !== "float") {
            throw new SemanticError(`Unary '-' requires int or float, got '${operandType}'`, expr.line);
          }
          t = operandType;
        } else if (expr.op === "!") {
          if (operandType !== "bool") {
            throw new SemanticError(`Unary '!' requires bool, got '${operandType}'`, expr.line);
          }
          t = "bool";
        }
        break;
      }

      case "Binary": {
        const leftType = this.checkExpr(expr.left, scope);
        const rightType = this.checkExpr(expr.right, scope);
        t = this.checkBinaryOp(expr.op, leftType, rightType, expr.line);
        break;
      }

      case "Logical": {
        const leftType = this.checkExpr(expr.left, scope);
        const rightType = this.checkExpr(expr.right, scope);
        if (leftType !== "bool" || rightType !== "bool") {
          throw new SemanticError(
            `Operator '${expr.op}' requires bool operands, got '${leftType}' and '${rightType}'`,
            expr.line
          );
        }
        t = "bool";
        break;
      }

      case "Call": {
        t = this.checkCallExpr(expr, scope, /* allowVoid */ false);
        break;
      }

      default:
        throw new SemanticError(`Unknown expression type '${expr.type}'`, expr.line);
    }

    expr.resolvedType = t;
    return t;
  }

  // Shared by checkExpr's Call case (result must be a value) and ExprStmt
  // (a bare call statement -- void is fine there since nothing consumes it).
  checkCallExpr(expr, scope, allowVoid) {
    const sig = this.functions.get(expr.callee);
    if (!sig) {
      throw new SemanticError(`Call to undeclared function '${expr.callee}'`, expr.line);
    }
    if (expr.args.length !== sig.paramTypes.length) {
      throw new SemanticError(
        `Function '${expr.callee}' expects ${sig.paramTypes.length} argument(s), got ${expr.args.length}`,
        expr.line
      );
    }
    for (let i = 0; i < expr.args.length; i++) {
      const argType = this.checkExpr(expr.args[i], scope);
      if (argType !== sig.paramTypes[i]) {
        throw new SemanticError(
          `Argument ${i + 1} to '${expr.callee}' should be '${sig.paramTypes[i]}', got '${argType}'`,
          expr.line
        );
      }
    }
    if (sig.returnType === "void" && !allowVoid) {
      throw new SemanticError(
        `Function '${expr.callee}' returns void and cannot be used as a value`,
        expr.line
      );
    }
    expr.resolvedType = sig.returnType; // may be 'void'; codegen must handle
    return sig.returnType;
  }

  checkBinaryOp(op, leftType, rightType, line) {
    const arithmetic = ["+", "-", "*", "/"];
    const comparison = ["<", ">", "<=", ">=", "==", "!="];

    if (arithmetic.includes(op)) {
      if (leftType !== rightType) {
        throw new SemanticError(
          `Operator '${op}' requires matching types, got '${leftType}' and '${rightType}'`,
          line
        );
      }
      if (leftType !== "int" && leftType !== "float") {
        throw new SemanticError(`Operator '${op}' requires int or float, got '${leftType}'`, line);
      }
      return leftType;
    }

    if (comparison.includes(op)) {
      if (leftType !== rightType) {
        throw new SemanticError(
          `Cannot compare '${leftType}' and '${rightType}'`,
          line
        );
      }
      return "bool";
    }

    throw new SemanticError(`Unknown operator '${op}'`, line);
  }
}

module.exports = { Analyzer, SemanticError };
