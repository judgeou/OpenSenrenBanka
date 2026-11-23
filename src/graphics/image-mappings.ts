import{psbRecord}from'../formats/psb-value.ts';import type{PsbValue}from'../formats/psb-value.ts';import{nativeBoolean}from'../world/native-values.ts';import type{DelimitedRow}from'../formats/delimited.ts';
import {nativeNoiseStorage} from './native-noise-descriptor.ts';
export interface ImageDifference{readonly alias:string;readonly file:string;readonly options:Readonly<{[key:string]:PsbValue}>;readonly line:number}
export interface ConditionalImageName{readonly file:string;readonly condition:string;readonly line:number}
export class ImageMappings{
 readonly differences=new Map<string,ImageDifference>();readonly conditions=new Map<string,readonly ConditionalImageName[]>();
 constructor(differences:readonly DelimitedRow[],conditions:readonly DelimitedRow[]){
 for(const row of differences){const cells=row.cells;if(cells.length<3||!cells[0]||cells[0].startsWith('#'))continue;const options:{[key:string]:PsbValue}=Object.create(null);for(let at=2;at<cells.length;at+=2){if(!cells[at])continue;if(cells[at+1]===undefined)throw new Error('Unpaired image difference option at '+row.line);options[cells[at]]=cells[at+1];}const alias=cells[0].toLowerCase();this.differences.set(alias,{alias,file:cells[1].toLowerCase(),options,line:row.line});}
 for(const row of conditions){const cells=row.cells;if(!cells[0]||!cells[1]||cells[0].startsWith('#'))continue;const key=cells[0].toLowerCase(),list=this.conditions.get(key)??[];this.conditions.set(key,[...list,{file:cells[1].toLowerCase(),condition:cells[2]??'',line:row.line}]);}
 }
 static fromDefinitions(value:PsbValue):ImageMappings{const root=psbRecord(value);if(!Array.isArray(root.tables))throw new Error('Missing original image tables');let differences:readonly DelimitedRow[]|undefined,conditions:readonly DelimitedRow[]|undefined;for(const value of root.tables){const table=psbRecord(value);if(typeof table.name!=='string'||!Array.isArray(table.rows))throw new Error('Invalid original image table');const key=table.name.toLowerCase();if(key==='imagediffmap.csv')differences=table.rows as unknown as readonly DelimitedRow[];if(key==='imageevalmap.csv')conditions=table.rows as unknown as readonly DelimitedRow[];}if(!differences||!conditions)throw new Error('Missing original conditional or difference map');return new ImageMappings(differences,conditions);}
 resolve(input:string,evaluate:(source:string)=>PsbValue,disableConditions=false,inputEvaluated=false):{readonly file:string;readonly options:Readonly<{[key:string]:PsbValue}>}{
    if(input===nativeNoiseStorage)return {file:input,options:Object.create(null)};
 if(input.includes(','))throw new Error('Inline image descriptors require explicit storage/option parsing');const evaluated=!inputEvaluated&&input.startsWith('&')?evaluate(input.slice(1)):input;if(typeof evaluated!=='string')throw new Error('Dynamic image name did not return a string');let file=evaluated.toLowerCase();
 if(!disableConditions){for(const candidate of this.conditions.get(file)??[])if(!candidate.condition||nativeBoolean(evaluate(candidate.condition))){const selected=candidate.file.startsWith('&')?evaluate(candidate.file.slice(1)):candidate.file;if(typeof selected!=='string')throw new Error('Conditional image name did not return text');file=selected.toLowerCase();break;}}
 const difference=this.differences.get(file);return difference?{file:difference.file,options:difference.options}:{file,options:Object.create(null)};
 }
}
