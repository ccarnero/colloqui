import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";

// ── AST node types ────────────────────────────────────────────────────

interface BoolOpNode {
  readonly kind: "BoolOp";
  readonly op: "and" | "or";
  readonly values: readonly AstNode[];
}

interface UnaryOpNode {
  readonly kind: "UnaryOp";
  readonly op: "not";
  readonly operand: AstNode;
}

interface CompareNode {
  readonly kind: "Compare";
  readonly left: AstNode;
  readonly op: "==" | "!=";
  readonly right: AstNode;
}

interface CallNode {
  readonly kind: "Call";
  readonly name: string;
  readonly args: readonly AstNode[];
}

interface NameNode {
  readonly kind: "Name";
  readonly name: string;
}

interface AttributeNode {
  readonly kind: "Attribute";
  readonly path: readonly string[];
}

interface ConstantNode {
  readonly kind: "Constant";
  readonly value: unknown;
}

type AstNode =
  | BoolOpNode
  | UnaryOpNode
  | CompareNode
  | CallNode
  | NameNode
  | AttributeNode
  | ConstantNode;

// ── Token types ───────────────────────────────────────────────────────

type TokenKind =
  | "AND"
  | "OR"
  | "NOT"
  | "EQ"
  | "NEQ"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "DOT"
  | "STRING"
  | "NUMBER"
  | "TRUE"
  | "FALSE"
  | "NULL"
  | "IDENT"
  | "EOF";

interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  readonly pos: number;
}

// ── Allowed helpers ───────────────────────────────────────────────────

const ALLOWED_HELPERS = new Set(["contains", "regex", "exists"]);

/**
 * Safe condition evaluator for pipeline step conditions.
 *
 * Implements a hand-written tokenizer + recursive descent parser for a
 * limited boolean expression grammar. No `eval()` or `new Function()` is
 * used — the condition string is parsed into an AST and evaluated against
 * a runtime state object.
 *
 * Grammar:
 *   expr       := and_expr (OR and_expr)*
 *   and_expr   := not_expr (AND not_expr)*
 *   not_expr   := NOT not_expr | comparison
 *   comparison := atom ((== | !=) atom)?
 *   atom       := helper_call | dot_path | literal | '(' expr ')'
 *   helper_call:= IDENT '(' (expr (',' expr)*)? ')'
 *   dot_path   := IDENT ('.' IDENT)*
 *   literal    := STRING | NUMBER | TRUE | FALSE | NULL
 */
@Injectable()
export class ConditionEvaluatorService {
  private readonly logger = new PinoLoggerService(
    ConditionEvaluatorService.name,
  );

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Evaluate whether a pipeline step should execute.
   *
   * @param condition - Condition string, boolean, or null/undefined.
   * @param state     - Current execution state (key-value map with nested objects).
   * @returns `true` if the step should run. Parse/eval errors return `false`.
   */
  shouldRunStep(
    condition: string | boolean | null | undefined,
    state: Record<string, unknown>,
  ): boolean {
    if (condition === null || condition === undefined) return true;
    if (typeof condition === "boolean") return condition;
    if (typeof condition !== "string") return Boolean(condition);

    const trimmed = condition.trim();
    if (trimmed.length === 0) return true;

    try {
      const tokens = this.tokenize(trimmed);
      const ast = this.parse(tokens);
      return Boolean(this.evaluate(ast, state));
    } catch (error) {
      this.logger.warn(
        `Condition evaluation failed: ${(error as Error).message}`,
      );
      return false;
    }
  }

  // ── Tokenizer ────────────────────────────────────────────────────

  private tokenize(expr: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    const isDigit = (c: string): boolean => c >= "0" && c <= "9";
    const isAlpha = (c: string): boolean =>
      (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
    const isAlphaNum = (c: string): boolean => isAlpha(c) || isDigit(c);

    while (i < expr.length) {
      const ch = expr[i];

      // Skip whitespace
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        i++;
        continue;
      }

      const pos = i;

      // Two-char operators
      if (i + 1 < expr.length) {
        const pair = ch + expr[i + 1];
        if (pair === "==") {
          tokens.push({ kind: "EQ", value: "==", pos });
          i += 2;
          continue;
        }
        if (pair === "!=") {
          tokens.push({ kind: "NEQ", value: "!=", pos });
          i += 2;
          continue;
        }
      }

      // Single-char tokens
      switch (ch) {
        case "(":
          tokens.push({ kind: "LPAREN", value: "(", pos });
          i++;
          continue;
        case ")":
          tokens.push({ kind: "RPAREN", value: ")", pos });
          i++;
          continue;
        case ",":
          tokens.push({ kind: "COMMA", value: ",", pos });
          i++;
          continue;
        case ".":
          tokens.push({ kind: "DOT", value: ".", pos });
          i++;
          continue;
      }

      // String literals
      if (ch === '"' || ch === "'") {
        const quote = ch;
        i++; // skip opening quote
        let value = "";
        while (i < expr.length && expr[i] !== quote) {
          if (expr[i] === "\\" && i + 1 < expr.length) {
            i++; // skip backslash, take next char literally
          }
          value += expr[i];
          i++;
        }
        if (i >= expr.length) {
          throw new Error(`Unterminated string at position ${pos}`);
        }
        i++; // skip closing quote
        tokens.push({ kind: "STRING", value, pos });
        continue;
      }

      // Number literals (including negative)
      if (
        isDigit(ch) ||
        (ch === "-" && i + 1 < expr.length && isDigit(expr[i + 1]))
      ) {
        const start = i;
        if (ch === "-") i++;
        while (i < expr.length && isDigit(expr[i])) i++;
        // Decimal part
        if (i < expr.length && expr[i] === ".") {
          i++;
          while (i < expr.length && isDigit(expr[i])) i++;
        }
        tokens.push({ kind: "NUMBER", value: expr.slice(start, i), pos });
        continue;
      }

      // Identifiers and keywords
      if (isAlpha(ch)) {
        const start = i;
        while (i < expr.length && isAlphaNum(expr[i])) i++;
        const word = expr.slice(start, i);
        const upper = word.toUpperCase();

        let kind: TokenKind;
        switch (upper) {
          case "AND":
            kind = "AND";
            break;
          case "OR":
            kind = "OR";
            break;
          case "NOT":
            kind = "NOT";
            break;
          case "TRUE":
            kind = "TRUE";
            break;
          case "FALSE":
            kind = "FALSE";
            break;
          case "NULL":
            kind = "NULL";
            break;
          default:
            kind = "IDENT";
            break;
        }
        tokens.push({ kind, value: word, pos });
        continue;
      }

      throw new Error(`Unexpected character '${ch}' at position ${i}`);
    }

    tokens.push({ kind: "EOF", value: "", pos: i });
    return tokens;
  }

  // ── Recursive descent parser ────────────────────────────────────

  private parse(tokens: Token[]): AstNode {
    let pos = 0;

    const peek = (): Token => tokens[pos];
    const advance = (): Token => tokens[pos++];
    const expect = (kind: TokenKind): Token => {
      const t = advance();
      if (t.kind !== kind) {
        throw new Error(
          `Expected ${kind}, got '${t.value}' (${t.kind}) at position ${t.pos}`,
        );
      }
      return t;
    };

    const parseExpr = (): AstNode => {
      let left = parseAndExpr();
      while (peek().kind === "OR") {
        advance();
        const right = parseAndExpr();
        left = flattenBoolOp(left, "or", right);
      }
      return left;
    };

    const parseAndExpr = (): AstNode => {
      let left = parseNotExpr();
      while (peek().kind === "AND") {
        advance();
        const right = parseNotExpr();
        left = flattenBoolOp(left, "and", right);
      }
      return left;
    };

    const parseNotExpr = (): AstNode => {
      if (peek().kind === "NOT") {
        advance();
        return { kind: "UnaryOp", op: "not", operand: parseNotExpr() };
      }
      return parseComparison();
    };

    const parseComparison = (): AstNode => {
      const left = parseAtom();
      const next = peek();
      if (next.kind === "EQ" || next.kind === "NEQ") {
        advance();
        const right = parseAtom();
        return {
          kind: "Compare",
          left,
          op: next.value as "==" | "!=",
          right,
        };
      }
      return left;
    };

    const parseAtom = (): AstNode => {
      const token = peek();

      switch (token.kind) {
        case "STRING":
          advance();
          return { kind: "Constant", value: token.value };

        case "NUMBER":
          advance();
          return { kind: "Constant", value: parseFloat(token.value) };

        case "TRUE":
          advance();
          return { kind: "Constant", value: true };

        case "FALSE":
          advance();
          return { kind: "Constant", value: false };

        case "NULL":
          advance();
          return { kind: "Constant", value: null };

        case "IDENT": {
          advance();

          // Helper call: name(args)
          if (peek().kind === "LPAREN") {
            if (!ALLOWED_HELPERS.has(token.value)) {
              throw new Error(
                `Unknown helper function '${token.value}' at position ${token.pos}`,
              );
            }
            advance(); // consume '('
            const args: AstNode[] = [];
            if (peek().kind !== "RPAREN") {
              args.push(parseExpr());
              while (peek().kind === "COMMA") {
                advance();
                args.push(parseExpr());
              }
            }
            expect("RPAREN");
            return { kind: "Call", name: token.value, args };
          }

          // Dot path: name.part1.part2...
          const path = [token.value];
          while (peek().kind === "DOT") {
            advance();
            path.push(expect("IDENT").value);
          }

          return path.length === 1
            ? { kind: "Name", name: path[0] }
            : { kind: "Attribute", path };
        }

        case "LPAREN": {
          advance();
          const inner = parseExpr();
          expect("RPAREN");
          return inner;
        }

        default:
          throw new Error(
            `Unexpected token '${token.value}' (${token.kind}) at position ${token.pos}`,
          );
      }
    };

    const ast = parseExpr();
    if (peek().kind !== "EOF") {
      throw new Error(
        `Unexpected token '${peek().value}' at position ${peek().pos}`,
      );
    }
    return ast;
  }

  // ── Evaluator ────────────────────────────────────────────────────

  private evaluate(
    node: AstNode,
    state: Record<string, unknown>,
  ): unknown {
    switch (node.kind) {
      case "Constant":
        return node.value;

      case "Name":
        return state[node.name];

      case "Attribute":
        return this.resolveDotPath(node.path, state);

      case "BoolOp": {
        if (node.op === "and") {
          return node.values.every((v) => Boolean(this.evaluate(v, state)));
        }
        return node.values.some((v) => Boolean(this.evaluate(v, state)));
      }

      case "UnaryOp":
        return !Boolean(this.evaluate(node.operand, state));

      case "Compare": {
        const left = this.evaluate(node.left, state);
        const right = this.evaluate(node.right, state);
        return node.op === "==" ? left === right : left !== right;
      }

      case "Call":
        return this.evaluateCall(node.name, node.args, state);
    }
  }

  private resolveDotPath(
    path: readonly string[],
    state: Record<string, unknown>,
  ): unknown {
    let current: unknown = state[path[0]];
    for (let i = 1; i < path.length; i++) {
      if (
        current === null ||
        current === undefined ||
        typeof current !== "object" ||
        Array.isArray(current)
      ) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[path[i]];
    }
    return current;
  }

  private evaluateCall(
    name: string,
    args: readonly AstNode[],
    state: Record<string, unknown>,
  ): unknown {
    const values = args.map((a) => this.evaluate(a, state));

    switch (name) {
      case "contains": {
        const [value, expected] = values;
        return String(value ?? "").includes(String(expected ?? ""));
      }
      case "regex": {
        const [pattern, value] = values;
        return new RegExp(String(pattern ?? ""), "i").test(
          String(value ?? ""),
        );
      }
      case "exists": {
        const [value] = values;
        return value !== null && value !== undefined && String(value) !== "";
      }
      default:
        throw new Error(`Unknown helper function '${name}'`);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Flatten consecutive BoolOp nodes of the same operator into a single node.
 * `a AND b AND c` → `BoolOp(and, [a, b, c])` instead of nested binary nodes.
 */
function flattenBoolOp(
  left: AstNode,
  op: "and" | "or",
  right: AstNode,
): BoolOpNode {
  if (left.kind === "BoolOp" && left.op === op) {
    return { kind: "BoolOp", op, values: [...left.values, right] };
  }
  return { kind: "BoolOp", op, values: [left, right] };
}
