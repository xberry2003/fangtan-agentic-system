const outline = new Set(['list_materials','read_document','save_interview_outline']);
const report = new Set(['list_materials','read_document','inspect_image','list_report_templates','read_report_template','create_report']);
export function toolAllowed(task,name){
  if(task==='outline-intake'||task==='report-intake')return false;
  if(task==='outline-generate')return outline.has(name);
  if(task==='report-generate')return report.has(name);
  return !['create_report','save_interview_outline','read_report_template','list_report_templates'].includes(name);
}
