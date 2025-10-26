// lib/ffmpeg-validator.js - FILTERGRAPH VALIDATION
/**
 * Validates FFmpeg filtergraph syntax before execution
 * Catches common errors: unbalanced brackets, invalid chars, circular refs
 */

export function validateFiltergraph(fg) {
  const errors = [];
  const warnings = [];
  
  // Remove whitespace for easier parsing
  const normalized = fg.replace(/\s+/g, '');
  
  // 1. Check balanced brackets
  const openBrackets = (normalized.match(/\[/g) || []).length;
  const closeBrackets = (normalized.match(/\]/g) || []).length;
  
  if (openBrackets !== closeBrackets) {
    errors.push(
      `Unbalanced filter labels: ${openBrackets} open brackets, ${closeBrackets} close brackets`
    );
  }
  
  // 2. Extract all filter labels
  const labels = normalized.match(/\[([^\]]+)\]/g) || [];
  const labelNames = labels.map(l => l.slice(1, -1));
  
  // 3. Check for duplicate output labels (would overwrite)
  const outputLabels = new Set();
  const parts = normalized.split(';').filter(p => p.trim());
  
  for (const part of parts) {
    const outputMatch = part.match(/\[([^\]]+)\](?=[^[]*$)/); // Last label in chain
    if (outputMatch) {
      const label = outputMatch[1];
      if (outputLabels.has(label)) {
        errors.push(`Duplicate output label: [${label}] (would cause overwrite)`);
      }
      outputLabels.add(label);
    }
  }
  
  // 4. Check for undefined input labels
  const definedLabels = new Set();
  
  for (const part of parts) {
    // Extract output label (last bracket)
    const outputMatch = part.match(/\[([^\]]+)\](?=[^[]*$)/);
    if (outputMatch) {
      definedLabels.add(outputMatch[1]);
    }
  }
  
  for (const part of parts) {
    // Extract input labels (all brackets except last)
    const inputMatches = part.match(/\[([^\]]+)\]/g) || [];
    if (inputMatches.length > 1) {
      // All but last are inputs
      for (let i = 0; i < inputMatches.length - 1; i++) {
        const inputLabel = inputMatches[i].slice(1, -1);
        
        // Check if it's a stream specifier (e.g., "0:a", "1:a")
        if (/^\d+:a$/.test(inputLabel)) {
          continue; // Valid input stream
        }
        
        // Otherwise it should be a previously defined label
        if (!definedLabels.has(inputLabel)) {
          errors.push(`Undefined input label: [${inputLabel}] in filter chain`);
        }
      }
    }
  }
  
  // 5. Check for forbidden characters in labels
  for (const label of labelNames) {
    if (/[^a-zA-Z0-9_]/.test(label.replace(/^\d+:a$/, ''))) {
      // Allow stream specifiers, but flag others
      if (!/^\d+:a$/.test(label)) {
        warnings.push(`Label [${label}] contains special characters (may cause issues)`);
      }
    }
  }
  
  // 6. Check for empty filter chains
  if (parts.some(p => !p.trim())) {
    warnings.push('Empty filter chain detected (extra semicolons?)');
  }
  
  // 7. Basic circular dependency check
  const graph = new Map();
  
  for (const part of parts) {
    const inputMatches = part.match(/\[([^\]]+)\]/g) || [];
    const outputMatch = part.match(/\[([^\]]+)\](?=[^[]*$)/);
    
    if (outputMatch && inputMatches.length > 1) {
      const output = outputMatch[1];
      const inputs = inputMatches.slice(0, -1).map(m => m.slice(1, -1));
      graph.set(output, inputs);
    }
  }
  
  // Simple DFS cycle detection
  const visiting = new Set();
  const visited = new Set();
  
  function hasCycle(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    
    visiting.add(node);
    for (const neighbor of graph.get(node) || []) {
      if (hasCycle(neighbor)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    
    return false;
  }
  
  for (const node of graph.keys()) {
    if (hasCycle(node)) {
      errors.push(`Circular dependency detected in filtergraph involving [${node}]`);
      break;
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}