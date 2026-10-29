const PATTERNS = [
    [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]'],
    [/\b(?:ghp|gho|ghs)_[A-Za-z0-9]{20,}\b/g, '[REDACTED_TOKEN]'],
    [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
    [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, 'Bearer [REDACTED]'],
    [/(password|passwd|secret|api[_-]?key|token)(["'\s:=]+)([^\s"',}]{6,})/gi, '$1$2[REDACTED]'],
    [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[REDACTED_EMAIL]'],
  ];
  
  export function redactString(s) {
    if (typeof s !== 'string') return s;
    return PATTERNS.reduce((acc, [re, rep]) => acc.replace(re, rep), s);
  }
  
  export function redact(value) {
    if (typeof value === 'string') return redactString(value);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
    }
    return value;
  }
  