const { TokenType: T } = require("./tokens");
const { Ast } = require("./ast");

class ParseError extends Error {
  constructor(message, token) {
    const where = token.type === T.EOF ? "end of input" : `'${token.lexeme}'`;
    super(`Parse error [line ${token.line}] at ${where}: ${message}`);
    this.token = token;
  }
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.current = 0;
  }

  // Public entry point. Returns an Ast.Program, or throws ParseError.
  parse() {
    const declarations = [];
    while (!this.isAtEnd()) {
      declarations.push(this.declaration());
    }
    return Ast.Program(declarations);
  }

  // ================= grammar rules =================
  // declaration → funcDecl | varDecl | statement
  declaration() {
    if (this.check(T.FN)) return this.funcDecl();
    if (this.check(T.LET)) return this.varDecl();
    return this.statement();
  }

  // funcDecl → "fn" IDENT "(" params? ")" ("->" type)? block
  funcDecl() {
    const line = this.advance().line; // consume 'fn'
    const name = this.consume(T.IDENT, "Expected function name").lexeme;
    this.consume(T.LPAREN, "Expected '(' after function name");

    const params = [];
    if (!this.check(T.RPAREN)) {
      do {
        const paramName = this.consume(T.IDENT, "Expected parameter name").lexeme;
        this.consume(T.COLON, "Expected ':' after parameter name");
        const paramType = this.typeName();
        params.push(Ast.Param(paramName, paramType));
      } while (this.match(T.COMMA));
    }
    this.consume(T.RPAREN, "Expected ')' after parameters");

    let returnType = null;
    if (this.match(T.ARROW)) {
      returnType = this.typeName();
    }

    const body = this.block();
    return Ast.FuncDecl(name, params, returnType, body, line);
  }

  // type → "int" | "float" | "bool"
  typeName() {
    if (this.match(T.TYPE_INT)) return "int";
    if (this.match(T.TYPE_FLOAT)) return "float";
    if (this.match(T.TYPE_BOOL)) return "bool";
    throw new ParseError("Expected a type (int, float, bool)", this.peek());
  }

  // varDecl → "let" IDENT (":" type)? "=" expression ";"
  varDecl() {
    const line = this.advance().line; // consume 'let'
    const name = this.consume(T.IDENT, "Expected variable name").lexeme;

    let varType = null;
    if (this.match(T.COLON)) {
      varType = this.typeName();
    }

    this.consume(T.ASSIGN, "Expected '=' in variable declaration");
    const initializer = this.expression();
    this.consume(T.SEMICOLON, "Expected ';' after variable declaration");
    return Ast.VarDecl(name, varType, initializer, line);
  }

  // statement → exprStmt | printStmt | ifStmt | whileStmt | returnStmt | block
  statement() {
    if (this.check(T.PRINT)) return this.printStmt();
    if (this.check(T.IF)) return this.ifStmt();
    if (this.check(T.WHILE)) return this.whileStmt();
    if (this.check(T.RETURN)) return this.returnStmt();
    if (this.check(T.LBRACE)) return this.block();
    return this.exprStmt();
  }

  printStmt() {
    const line = this.advance().line; // consume 'print'
    this.consume(T.LPAREN, "Expected '(' after 'print'");
    const expression = this.expression();
    this.consume(T.RPAREN, "Expected ')' after expression");
    this.consume(T.SEMICOLON, "Expected ';' after print statement");
    return Ast.PrintStmt(expression, line);
  }

  ifStmt() {
    const line = this.advance().line; // consume 'if'
    this.consume(T.LPAREN, "Expected '(' after 'if'");
    const condition = this.expression();
    this.consume(T.RPAREN, "Expected ')' after condition");
    const thenBranch = this.block();
    let elseBranch = null;
    if (this.match(T.ELSE)) {
      elseBranch = this.check(T.IF) ? this.ifStmt() : this.block();
    }
    return Ast.IfStmt(condition, thenBranch, elseBranch, line);
  }

  whileStmt() {
    const line = this.advance().line; // consume 'while'
    this.consume(T.LPAREN, "Expected '(' after 'while'");
    const condition = this.expression();
    this.consume(T.RPAREN, "Expected ')' after condition");
    const body = this.block();
    return Ast.WhileStmt(condition, body, line);
  }

  returnStmt() {
    const line = this.advance().line; // consume 'return'
    let value = null;
    if (!this.check(T.SEMICOLON)) {
      value = this.expression();
    }
    this.consume(T.SEMICOLON, "Expected ';' after return statement");
    return Ast.ReturnStmt(value, line);
  }

  block() {
    this.consume(T.LBRACE, "Expected '{'");
    const statements = [];
    while (!this.check(T.RBRACE) && !this.isAtEnd()) {
      statements.push(this.declaration());
    }
    this.consume(T.RBRACE, "Expected '}' after block");
    return Ast.Block(statements);
  }

  exprStmt() {
    const expression = this.expression();
    const line = this.previous().line;
    this.consume(T.SEMICOLON, "Expected ';' after expression");
    return Ast.ExprStmt(expression, line);
  }

  // ================= expressions (precedence climbing) =================
  // expression → assignment
  expression() {
    return this.assignment();
  }

  // assignment → IDENT "=" assignment | logic_or
  assignment() {
    const expr = this.logicOr();

    if (this.match(T.ASSIGN)) {
      const equalsToken = this.previous();
      const value = this.assignment(); // right-associative
      if (expr.type === "Variable") {
        return Ast.Assign(expr.name, value, equalsToken.line);
      }
      throw new ParseError("Invalid assignment target", equalsToken);
    }
    return expr;
  }

  // logic_or → logic_and ("||" logic_and)*
  logicOr() {
    let expr = this.logicAnd();
    while (this.match(T.OR)) {
      const op = this.previous();
      const right = this.logicAnd();
      expr = Ast.Logical("||", expr, right, op.line);
    }
    return expr;
  }

  // logic_and → equality ("&&" equality)*
  logicAnd() {
    let expr = this.equality();
    while (this.match(T.AND)) {
      const op = this.previous();
      const right = this.equality();
      expr = Ast.Logical("&&", expr, right, op.line);
    }
    return expr;
  }

  // equality → comparison (("==" | "!=") comparison)*
  equality() {
    let expr = this.comparison();
    while (this.match(T.EQ, T.NEQ)) {
      const op = this.previous();
      const right = this.comparison();
      expr = Ast.Binary(op.type === T.EQ ? "==" : "!=", expr, right, op.line);
    }
    return expr;
  }

  // comparison → term (("<" | ">" | "<=" | ">=") term)*
  comparison() {
    let expr = this.term();
    while (this.match(T.LT, T.GT, T.LTE, T.GTE)) {
      const op = this.previous();
      const right = this.term();
      const symbol = { LT: "<", GT: ">", LTE: "<=", GTE: ">=" }[op.type];
      expr = Ast.Binary(symbol, expr, right, op.line);
    }
    return expr;
  }

  // term → factor (("+" | "-") factor)*
  term() {
    let expr = this.factor();
    while (this.match(T.PLUS, T.MINUS)) {
      const op = this.previous();
      const right = this.factor();
      expr = Ast.Binary(op.type === T.PLUS ? "+" : "-", expr, right, op.line);
    }
    return expr;
  }

  // factor → unary (("*" | "/") unary)*
  factor() {
    let expr = this.unary();
    while (this.match(T.STAR, T.SLASH)) {
      const op = this.previous();
      const right = this.unary();
      expr = Ast.Binary(op.type === T.STAR ? "*" : "/", expr, right, op.line);
    }
    return expr;
  }

  // unary → ("-" | "!") unary | call
  unary() {
    if (this.match(T.MINUS, T.NOT)) {
      const op = this.previous();
      const operand = this.unary();
      return Ast.Unary(op.type === T.MINUS ? "-" : "!", operand, op.line);
    }
    return this.call();
  }

  // call → primary ("(" arguments? ")")*
  call() {
    let expr = this.primary();
    while (this.check(T.LPAREN)) {
      const line = this.advance().line; // consume '('
      const args = [];
      if (!this.check(T.RPAREN)) {
        do {
          args.push(this.expression());
        } while (this.match(T.COMMA));
      }
      this.consume(T.RPAREN, "Expected ')' after arguments");
      if (expr.type !== "Variable") {
        throw new ParseError("Can only call functions by name", this.previous());
      }
      expr = Ast.Call(expr.name, args, line);
    }
    return expr;
  }

  // primary → NUMBER | IDENT | "(" expression ")" | "true" | "false"
  primary() {
    if (this.match(T.NUMBER)) {
      const tok = this.previous();
      return Ast.NumberLit(tok.literal.value, tok.literal.isFloat, tok.line);
    }
    if (this.match(T.TRUE)) return Ast.BoolLit(true, this.previous().line);
    if (this.match(T.FALSE)) return Ast.BoolLit(false, this.previous().line);
    if (this.match(T.IDENT)) {
      const tok = this.previous();
      return Ast.Variable(tok.lexeme, tok.line);
    }
    if (this.match(T.LPAREN)) {
      const expr = this.expression();
      this.consume(T.RPAREN, "Expected ')' after expression");
      return expr;
    }
    throw new ParseError("Expected an expression", this.peek());
  }

  // ================= token stream helpers =================
  match(...types) {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  check(type) {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  advance() {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  isAtEnd() {
    return this.peek().type === T.EOF;
  }

  peek() {
    return this.tokens[this.current];
  }

  previous() {
    return this.tokens[this.current - 1];
  }

  consume(type, message) {
    if (this.check(type)) return this.advance();
    throw new ParseError(message, this.peek());
  }
}

module.exports = { Parser, ParseError };
