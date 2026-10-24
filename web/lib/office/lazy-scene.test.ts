// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../app/office/Office.tsx', import.meta.url), 'utf8');
const office = ts.createSourceFile('Office.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

describe('lazy office scene', () => {
  it('keeps scene and WebGL runtime imports out of the initial module', () => {
    const runtimeImports = office.statements.filter(ts.isImportDeclaration).filter(statement => {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) return false;
      const name = statement.moduleSpecifier.text;
      if (name !== './scene' && name !== 'three' && !name.startsWith('three/') && !name.startsWith('@react-three/')) return false;
      const clause = statement.importClause;
      if (!clause) return true;
      if (clause.isTypeOnly) return false;
      if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return true;
      return clause.namedBindings.elements.some(binding => !binding.isTypeOnly);
    });
    expect(runtimeImports.map(statement => statement.getText(office))).toEqual([]);
  });

  it('loads the scene dynamically with server rendering disabled and a loading state', () => {
    const declarations = office.statements.filter(ts.isVariableStatement)
      .flatMap(statement => [...statement.declarationList.declarations]);
    const scene = declarations.find(declaration => declaration.name.getText(office) === 'OfficeScene');
    const initializer = scene?.initializer;
    expect(initializer && ts.isCallExpression(initializer)).toBe(true);
    if (!initializer || !ts.isCallExpression(initializer)) throw new Error('Missing dynamic scene loader');
    expect(initializer.expression.getText(office)).toBe('dynamic');
    expect(initializer.arguments[0]?.getText(office)).toMatch(/import\(['"]\.\/scene['"]\)/);
    expect(initializer.arguments[1]?.getText(office)).toMatch(/ssr:\s*false/);
    expect(initializer.arguments[1]?.getText(office)).toMatch(/loading:\s*SceneLoading/);
  });
});
