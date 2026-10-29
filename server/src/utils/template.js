export function renderTemplate(template, vars = {}) {
    return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
      const v = vars[key];
      if (v === undefined || v === null) return '';
      return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    });
  }

  export function resolveInputs(inputDefs = [], raw = {}) {
    const out = {};
    const errors = [];
    for (const def of inputDefs) {
      let v = raw[def.key];
      if ((v === undefined || v === '') && def.defaultValue) v = def.defaultValue;
      if ((v === undefined || v === '') && def.required) {
        errors.push(`Missing required input: ${def.key}`);
        continue;
      }
      if (v === undefined) continue;
      if (def.type === 'json' && typeof v === 'string') {
        try {
          v = JSON.parse(v);
        } catch {
          errors.push(`Input "${def.key}" must be valid JSON`);
          continue;
        }
      }
      if (def.type === 'number') {
        v = Number(v);
        if (Number.isNaN(v)) {
          errors.push(`Input "${def.key}" must be a number`);
          continue;
        }
      }
      out[def.key] = v;
    }
    return { values: out, errors };
  }
  