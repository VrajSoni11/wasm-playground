// Token types for our source language
const TokenType = {
  // Literals
  NUMBER: "NUMBER",
  IDENT: "IDENT",

  // Keywords
  FN: "FN",
  LET: "LET",
  IF: "IF",
  ELSE: "ELSE",
  WHILE: "WHILE",
  RETURN: "RETURN",
  PRINT: "PRINT",
  TRUE: "TRUE",
  FALSE: "FALSE",
  TYPE_INT: "TYPE_INT",
  TYPE_FLOAT: "TYPE_FLOAT",
  TYPE_BOOL: "TYPE_BOOL",

  // Operators
  PLUS: "PLUS",
  MINUS: "MINUS",
  STAR: "STAR",
  SLASH: "SLASH",
  ASSIGN: "ASSIGN",
  EQ: "EQ",
  NEQ: "NEQ",
  LT: "LT",
  GT: "GT",
  LTE: "LTE",
  GTE: "GTE",
  AND: "AND",
  OR: "OR",
  NOT: "NOT",

  // Punctuation
  LPAREN: "LPAREN",
  RPAREN: "RPAREN",
  LBRACE: "LBRACE",
  RBRACE: "RBRACE",
  COMMA: "COMMA",
  COLON: "COLON",
  SEMICOLON: "SEMICOLON",
  ARROW: "ARROW",

  EOF: "EOF",
};

// Reserved keyword lookup
const KEYWORDS = {
  fn: TokenType.FN,
  let: TokenType.LET,
  if: TokenType.IF,
  else: TokenType.ELSE,
  while: TokenType.WHILE,
  return: TokenType.RETURN,
  print: TokenType.PRINT,
  true: TokenType.TRUE,
  false: TokenType.FALSE,
  int: TokenType.TYPE_INT,
  float: TokenType.TYPE_FLOAT,
  bool: TokenType.TYPE_BOOL,
};

class Token {
  constructor(type, lexeme, literal, line, col) {
    this.type = type;
    this.lexeme = lexeme; // raw source text
    this.literal = literal; // parsed value (for NUMBER)
    this.line = line;
    this.col = col;
  }

  toString() {
    return `Token(${this.type}, '${this.lexeme}', line=${this.line})`;
  }
}

module.exports = { TokenType, KEYWORDS, Token };
