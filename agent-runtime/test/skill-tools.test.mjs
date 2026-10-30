import test from 'node:test';
import assert from 'node:assert/strict';
import {toolAllowed} from '../skill-tools.mjs';
test('generation skills do not share write tools or template procedures',()=>{
  for(const name of ['create_report','read_report_template','list_report_templates','create_document','update_document'])assert.equal(toolAllowed('outline-generate',name),false);
  for(const name of ['save_interview_outline','start_interview_outline','create_document','update_document'])assert.equal(toolAllowed('report-generate',name),false);
  assert.equal(toolAllowed('outline-generate','save_interview_outline'),true);
  assert.equal(toolAllowed('report-generate','create_report'),true);
  assert.equal(toolAllowed('chat','create_report'),false);
  assert.equal(toolAllowed('chat','create_document'),true);
});
