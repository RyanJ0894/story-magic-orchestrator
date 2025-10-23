import { DirectorJSON } from '../lib/zod-schemas.js';

console.log('🧪 Running Story Magic Orchestrator Tests...\n');

// Test 1: Schema Validation
console.log('Test 1: Director JSON Schema Validation');
const testDirectorJSON = {
  project_id: 'test-project-123',
  scenes: [
    {
      scene_id: 'scene_1',
      mood: 'tense',
      intensity: 0.8,
      dialogue: [
        {
          line_id: 'line_1',
          character: 'Medic',
          text: 'Hold still, soldier, we\'ll stop the bleeding.'
        },
        {
          line_id: 'line_2',
          character: 'Soldier',
          text: 'Pipe down, Nelson...'
        }
      ]
    }
  ]
};

try {
  const validated = DirectorJSON.parse(testDirectorJSON);
  console.log('✅ Schema validation passed');
  console.log(`   Project: ${validated.project_id}`);
  console.log(`   Scenes: ${validated.scenes.length}`);
  console.log(`   Lines: ${validated.scenes[0].dialogue.length}\n`);
} catch (error) {
  console.error('❌ Schema validation failed:', error.message);
  process.exit(1);
}

// Test 2: Environment Variables
console.log('Test 2: Environment Variables Check');
const requiredEnvVars = [
  'ELEVENLABS_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY'
];

let missingVars = [];
for (const varName of requiredEnvVars) {
  if (process.env[varName]) {
    console.log(`✅ ${varName} is set`);
  } else {
    console.log(`❌ ${varName} is missing`);
    missingVars.push(varName);
  }
}

if (missingVars.length > 0) {
  console.log(`\n⚠️  Missing environment variables: ${missingVars.join(', ')}`);
  console.log('   Make sure your .env file is properly configured.\n');
} else {
  console.log('\n✅ All environment variables are configured!\n');
}

console.log('🎉 Tests complete!');