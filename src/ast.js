// AST node factory functions. Every node is a plain object with a `type`
// discriminator so it can be JSON.stringify'd directly (handy for a
// playground UI that visualizes the AST) and pattern-matched in later phases.

const Ast = {
  // ---- Program ----
  Program: (declarations) => ({ type: "Program", declarations }),

  // ---- Declarations ----
  FuncDecl: (name, params, returnType, body, line) => ({
    type: "FuncDecl", name, params, returnType, body, line,
  }),
  Param: (name, paramType) => ({ type: "Param", name, paramType }),
  VarDecl: (name, varType, initializer, line) => ({
    type: "VarDecl", name, varType, initializer, line,
  }),

  // ---- Statements ----
  ExprStmt: (expression, line) => ({ type: "ExprStmt", expression, line }),
  PrintStmt: (expression, line) => ({ type: "PrintStmt", expression, line }),
  IfStmt: (condition, thenBranch, elseBranch, line) => ({
    type: "IfStmt", condition, thenBranch, elseBranch, line,
  }),
  WhileStmt: (condition, body, line) => ({
    type: "WhileStmt", condition, body, line,
  }),
  ReturnStmt: (value, line) => ({ type: "ReturnStmt", value, line }),
  Block: (statements) => ({ type: "Block", statements }),

  // ---- Expressions ----
  Assign: (name, value, line) => ({ type: "Assign", name, value, line }),
  Binary: (op, left, right, line) => ({ type: "Binary", op, left, right, line }),
  Logical: (op, left, right, line) => ({ type: "Logical", op, left, right, line }),
  Unary: (op, operand, line) => ({ type: "Unary", op, operand, line }),
  Call: (callee, args, line) => ({ type: "Call", callee, args, line }),
  Variable: (name, line) => ({ type: "Variable", name, line }),
  NumberLit: (value, isFloat, line) => ({ type: "NumberLit", value, isFloat, line }),
  BoolLit: (value, line) => ({ type: "BoolLit", value, line }),
};

module.exports = { Ast };
