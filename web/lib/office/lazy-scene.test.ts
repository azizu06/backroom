// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function parse(file: string) {
  const text = readFileSync(new URL(`../../app/office/${file}`, import.meta.url), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
const office = parse('Office.tsx');
/** Modules in the initial office bundle; only the lazy scene (and its ./play rig) may load WebGL. */
const initialBundle = [office, parse('PlayHud.tsx'), parse('RoomEntryLabel.tsx'), parse('FloorPlan.tsx'), parse('RoomInspector.tsx'), parse('ReceiptList.tsx'), parse('ViewBoundary.tsx'), parse('panels/index.ts'), parse('panels/types.ts'), parse('panels/DeskPanel.tsx'), parse('panels/TreasuryPanel.tsx'), parse('panels/PaylinkPanel.tsx'), parse('panels/ServerPanel.tsx'), parse('panels/HandoffPanel.tsx'), parse('panels/AgentTalkPanel.tsx'), parse('handoffs/HandoffPresentation.tsx'), parse('handoffs/HandoffLog.tsx'), parse('handoffs/HandoffDetails.tsx'), parse('handoffs/HandoffText.tsx')];

describe('lazy office scene', () => {
  it.each(initialBundle.map(file => [file.fileName, file] as const))('keeps scene and WebGL runtime imports out of %s', (_, file) => {
    const runtimeImports = file.statements.filter(ts.isImportDeclaration).filter(statement => {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) return false;
      const name = statement.moduleSpecifier.text;
      if (name !== './scene' && name !== './play' && name !== 'three' && !name.startsWith('three/') && !name.startsWith('@react-three/')) return false;
      const clause = statement.importClause;
      if (!clause) return true;
      if (clause.isTypeOnly) return false;
      if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return true;
      return clause.namedBindings.elements.some(binding => !binding.isTypeOnly);
    });
    expect(runtimeImports.map(statement => statement.getText(file))).toEqual([]);
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
