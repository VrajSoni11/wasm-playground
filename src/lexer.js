const { TokenType, KEYWORDS, Token } = require("./tokens");

class LexError extends Error {
  constructor(message, line, col) {
    super(`Lexer error [line ${line}:${col}]: ${message}`);
    this.line = line;
    this.col = col;
  }
}

class Lexer {
  constructor(source) {
    this.source = source;
    this.start = 0; // start of current lexeme
    this.current = 0; // current scan position
    this.line = 1;
    this.col = 1;
    this.tokens = [];
  }

  // Public entry point: scan the whole source, return array of Tokens
  scanTokens() {
    while (!this.isAtEnd()) {
      this.start = this.current;
      this.scanToken();
    }
    this.tokens.push(new Token(TokenType.EOF, "", null, this.line, this.col));
    return this.tokens;
  }

  // ---- helpers ----
  isAtEnd() {
    return this.current >= this.source.length;
  }

  advance() {
    const c = this.source[this.current++];
    this.col++;
    return c;
  }

  peek() {
    if (this.isAtEnd()) return "\0";
    return this.source[this.current];
  }

  peekNext() {
    if (this.current + 1 >= this.source.length) return "\0";
    return this.source[this.current + 1];
  }

  match(expected) {
    if (this.isAtEnd()) return false;
    if (this.source[this.current] !== expected) return false;
    this.current++;
    this.col++;
    return true;
  }

  addToken(type, literal = null) {
    const lexeme = this.source.slice(this.start, this.current);
    this.tokens.push(
      new Token(type, lexeme, literal, this.line, this.col - lexeme.length)
    );
  }

  // ---- core scanning ----
  scanToken() {
    const c = this.advance();

    switch (c) {
      // whitespace
      case " ":
      case "\r":
      case "\t":
        break;
      case "\n":
        this.line++;
        this.col = 1;
        break;

      // single-char punctuation
      case "(":
        this.addToken(TokenType.LPAREN);
        break;
      case ")":
        this.addToken(TokenType.RPAREN);
        break;
      case "{":
        this.addToken(TokenType.LBRACE);
        break;
      case "}":
        this.addToken(TokenType.RBRACE);
        break;
      case ",":
        this.addToken(TokenType.COMMA);
        break;
      case ":":
        this.addToken(TokenType.COLON);
        break;
      case ";":
        this.addToken(TokenType.SEMICOLON);
        break;
      case "+":
        this.addToken(TokenType.PLUS);
        break;
      case "*":
        this.addToken(TokenType.STAR);
        break;

      // operators that may be part of a two-char token
      case "-":
        this.addToken(this.match(">") ? TokenType.ARROW : TokenType.MINUS);
        break;
      case "=":
        this.addToken(this.match("=") ? TokenType.EQ : TokenType.ASSIGN);
        break;
      case "!":
        this.addToken(this.match("=") ? TokenType.NEQ : TokenType.NOT);
        break;
      case "<":
        this.addToken(this.match("=") ? TokenType.LTE : TokenType.LT);
        break;
      case ">":
        this.addToken(this.match("=") ? TokenType.GTE : TokenType.GT);
        break;
      case "&":
        if (this.match("&")) this.addToken(TokenType.AND);
        else throw new LexError(`Unexpected character '&'`, this.line, this.col);
        break;
      case "|":
        if (this.match("|")) this.addToken(TokenType.OR);
        else throw new LexError(`Unexpected character '|'`, this.line, this.col);
        break;

      // comments and slash
      case "/":
        if (this.match("/")) {
          // line comment: consume until newline
          while (this.peek() !== "\n" && !this.isAtEnd()) this.advance();
        } else {
          this.addToken(TokenType.SLASH);
        }
        break;

      default:
        if (this.isDigit(c)) {
          this.number();
        } else if (this.isAlpha(c)) {
          this.identifier();
        } else {
          throw new LexError(`Unexpected character '${c}'`, this.line, this.col);
        }
    }
  }

  number() {
    while (this.isDigit(this.peek())) this.advance();

    let isFloat = false;
    if (this.peek() === "." && this.isDigit(this.peekNext())) {
      isFloat = true;
      this.advance(); // consume '.'
      while (this.isDigit(this.peek())) this.advance();
    }

    const text = this.source.slice(this.start, this.current);
    const value = isFloat ? parseFloat(text) : parseInt(text, 10);
    this.addToken(TokenType.NUMBER, { value, isFloat });
  }

  identifier() {
    while (this.isAlphaNumeric(this.peek())) this.advance();
    const text = this.source.slice(this.start, this.current);
    const type = KEYWORDS[text] || TokenType.IDENT;
    this.addToken(type);
  }

  isDigit(c) {
    return c >= "0" && c <= "9";
  }

  isAlpha(c) {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
  }

  isAlphaNumeric(c) {
    return this.isAlpha(c) || this.isDigit(c);
  }
}

module.exports = { Lexer, LexError };
