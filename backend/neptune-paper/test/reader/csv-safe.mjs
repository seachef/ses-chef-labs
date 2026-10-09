// CSV output is local-only. Callers must project an explicit public field allowlist.
export function csvCell(value){
 let text;
 if(value===null||value===undefined)text='';
 else if(typeof value==='number')text=Number.isFinite(value)?String(value):'';
 else if(typeof value==='boolean')text=String(value);
 else if(typeof value==='string'){
  text=value;
  // Spreadsheet formulas can start after whitespace, BOM or invisible direction marks.
  if(/^[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069]*[=+\-@]/u.test(text)||/^[\t\r\n]/u.test(text))text="'"+text;
 }else throw Error('CSV supports only projected scalar fields');
 return '"'+text.replaceAll('"','""')+'"';
}
export function csvRows(columns,rows){
 if(!Array.isArray(columns)||!columns.every(c=>typeof c==='string')||!Array.isArray(rows))throw Error('Invalid CSV rows');
 return [columns.map(csvCell).join(','),...rows.map(row=>{if(!Array.isArray(row)||row.length!==columns.length)throw Error('Invalid CSV row');return row.map(csvCell).join(',');})].join('\r\n')+'\r\n';
}
