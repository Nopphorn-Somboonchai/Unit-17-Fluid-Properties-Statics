/**
 * Automated Verification Test Suite for Unit 17 Fluid Mechanics Question Bank
 * Run with: npm test  OR  node test_questions.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('='.repeat(70));
console.log('🧪 RUNNING AUTOMATED VERIFICATION: UNIT 17 QUESTION BANK');
console.log('='.repeat(70));

// 1. Load app.js into a sandboxed VM with browser mocks
const appJsPath = path.join(__dirname, 'app.js');
let appJsCode = fs.readFileSync(appJsPath, 'utf8');

const mockWindow = `
const window = { addEventListener: () => {} };
const document = {
  getElementById: () => ({ innerText: '', innerHTML: '', classList: { add: () => {}, remove: () => {} } }),
  querySelectorAll: () => [],
  addEventListener: () => {}
};
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
`;

// Expose QUESTION_TEMPLATES and helper functions to this context
appJsCode += `
this.QUESTION_TEMPLATES = QUESTION_TEMPLATES;
this.isNumericAnswerCorrect = isNumericAnswerCorrect;
this.getOffsetFromR = getOffsetFromR;
this.SeededRNG = SeededRNG;
`;

const sandbox = {
  console,
  Math,
  parseInt,
  parseFloat,
  Number,
  String,
  Set,
  Array,
  Date,
  JSON
};

const context = vm.createContext(sandbox);
try {
  vm.runInContext(mockWindow + '\n' + appJsCode, context);
} catch (e) {
  console.error('❌ Failed to parse or load app.js:', e);
  process.exit(1);
}

const templates = context.QUESTION_TEMPLATES;
const isNumericAnswerCorrect = context.isNumericAnswerCorrect;

console.log(`✅ Loaded ${templates.length} question templates from app.js\n`);

let totalTests = 0;
let passedTests = 0;
let errors = [];

// 2. Test each template with seeds 1 to 50
const studentSeedsToTest = [
  ...Array.from({ length: 50 }, (_, i) => i + 1), // Student numbers 1 - 50
  0, // Student number 0
  null // Standard / non-seeded mode
];

for (const tmpl of templates) {
  let templatePassed = 0;

  for (const studentNum of studentSeedsToTest) {
    totalTests++;
    const seed = studentNum !== null 
      ? `${studentNum}_172000000_att1_${tmpl.id}_1`
      : null;

    try {
      const inst = tmpl.generate(seed);
      const params = inst.params || {};

      // A. Text rendering check
      const text = tmpl.text(params);
      if (typeof text !== 'string' || text.trim() === '') {
        throw new Error(`Question text is empty or not a string`);
      }
      if (text.includes('undefined')) {
        throw new Error(`Question text contains 'undefined'`);
      }
      if (text.includes('NaN')) {
        throw new Error(`Question text contains 'NaN'`);
      }

      // B. Explanation rendering check
      const choices = tmpl.choices || [];
      const expl = typeof inst.explanation === 'function' ? inst.explanation(choices) : '';
      if (typeof expl !== 'string' || expl.trim() === '') {
        throw new Error(`Explanation is empty or not a string`);
      }
      if (expl.includes('undefined')) {
        throw new Error(`Explanation contains 'undefined'`);
      }
      if (expl.includes('NaN')) {
        throw new Error(`Explanation contains 'NaN'`);
      }

      // C. Answers validation
      if (!Array.isArray(inst.answers) || inst.answers.length === 0) {
        throw new Error(`Missing or empty 'answers' array`);
      }
      if (!Array.isArray(inst.answersRaw) || inst.answersRaw.length === 0) {
        throw new Error(`Missing or empty 'answersRaw' array`);
      }

      // D. Self-consistency check on numeric grading
      if (tmpl.type === 'numeric_single') {
        const rawAns = inst.answersRaw[0];
        const isSelfCorrect = isNumericAnswerCorrect(String(rawAns), rawAns);
        if (!isSelfCorrect) {
          throw new Error(`isNumericAnswerCorrect rejected its own raw answer: ${rawAns}`);
        }
      }

      // E. Mathematical & Text Consistency Verification for Specific Problems
      if (tmpl.id === '17_3_2_piston_force') {
        // Verify displayed mass equals m
        const expectedMass = params.m_add ? (params.m_base + params.m_add) : params.m;
        if (params.m !== expectedMass) {
          throw new Error(`17_3_2_piston_force: m (${params.m}) does not match m_base + m_add (${expectedMass})`);
        }
        // Verify small force calculation
        const M = params.R / params.r;
        const expectedFSmall = Math.round((params.m * 10) / (M * M));
        if (inst.answersRaw[0] !== expectedFSmall) {
          throw new Error(`17_3_2_piston_force: answer ${inst.answersRaw[0]} does not match expected ${expectedFSmall}`);
        }
      } else if (tmpl.id === '17_3_3_submerged_ratio') {
        // Verify displayed density equals rho_w
        const expectedRho = params.rho_w_add ? (params.rho_w_base + params.rho_w_add) : params.rho_w;
        if (params.rho_w !== expectedRho) {
          throw new Error(`17_3_3_submerged_ratio: rho_w (${params.rho_w}) does not match rho_w_base + rho_w_add (${expectedRho})`);
        }
        const expectedFraction = Math.round((params.rho_w / 1000) * 100);
        if (inst.answersRaw[0] !== expectedFraction) {
          throw new Error(`17_3_3_submerged_ratio: answer ${inst.answersRaw[0]} does not match expected ${expectedFraction}`);
        }
      } else if (tmpl.id === '17_3_3_apparent_weight') {
        // Verify displayed volume equals vol_L
        const expectedVol = params.vol_add ? parseFloat((params.vol_L_base + params.vol_add).toFixed(1)) : params.vol_L;
        if (Math.abs(params.vol_L - expectedVol) > 0.001) {
          throw new Error(`17_3_3_apparent_weight: vol_L (${params.vol_L}) does not match vol_L_base + vol_add (${expectedVol})`);
        }
      } else if (tmpl.id === '17_2_1_ring_tension') {
        // Verify displayed force equals f
        const expectedF = params.f_add ? parseFloat((params.f_base + params.f_add).toFixed(4)) : params.f;
        if (Math.abs(params.f - expectedF) > 0.0001) {
          throw new Error(`17_2_1_ring_tension: f (${params.f}) does not match f_base + f_add (${expectedF})`);
        }
      } else if (tmpl.id === '17_3_1_pressure_depth') {
        // Verify depth h equals h_base + h_add
        const expectedH = params.h_add ? (params.h_base + params.h_add) : params.h;
        if (params.h !== expectedH) {
          throw new Error(`17_3_1_pressure_depth: h (${params.h}) does not match h_base + h_add (${expectedH})`);
        }
      }

      passedTests++;
      templatePassed++;
    } catch (err) {
      errors.push({
        templateId: tmpl.id,
        studentNum,
        error: err.message
      });
    }
  }

  const status = templatePassed === studentSeedsToTest.length ? '✅' : '❌';
  console.log(`  ${status} [${tmpl.topic}] ${tmpl.id.padEnd(32)} (${templatePassed}/${studentSeedsToTest.length} seeds passed)`);
}

// 3. Final Summary Report
console.log('\n' + '='.repeat(70));
console.log(`📊 SUMMARY: ${passedTests}/${totalTests} tests passed (${Math.round((passedTests / totalTests) * 100)}%)`);
console.log('='.repeat(70));

if (errors.length > 0) {
  console.error(`\n❌ Found ${errors.length} failed tests:`);
  errors.slice(0, 10).forEach(e => {
    console.error(`  - Template '${e.templateId}' (seed #${e.studentNum}): ${e.error}`);
  });
  if (errors.length > 10) {
    console.error(`  ... and ${errors.length - 10} more errors.`);
  }
  process.exit(1);
} else {
  console.log('\n🎉 ALL 28 TEMPLATES PASSED ACROSS ALL SEED VARIATIONS (100% CONSISTENT)!');
  process.exit(0);
}
