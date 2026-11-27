import {useEffect,useMemo,useState} from 'react';
import CodeMirror,{EditorView} from '@uiw/react-codemirror';
import type {ReactCodeMirrorProps} from '@uiw/react-codemirror';
type Extensions=NonNullable<ReactCodeMirrorProps['extensions']>;
async function languageExtensions(name:string):Promise<Extensions>{
 const language=name.toLowerCase();
 if(language.includes('python')||language==='py')return [(await import('@codemirror/lang-python')).python()];
 if(['javascript','js','typescript','ts','jsx','tsx'].includes(language))return [(await import('@codemirror/lang-javascript')).javascript({typescript:language.includes('type')||['ts','tsx'].includes(language),jsx:language.endsWith('x')})];
 if(language==='java')return [(await import('@codemirror/lang-java')).java()];
 if(['c','cpp','c++','csharp','c#'].includes(language))return [(await import('@codemirror/lang-cpp')).cpp()];
 if(language==='sql')return [(await import('@codemirror/lang-sql')).sql()];
 if(language==='html')return [(await import('@codemirror/lang-html')).html()];
 if(language==='css')return [(await import('@codemirror/lang-css')).css()];
 return [];
}
export default function CodeAnswerEditor({value,onChange,language,label,maxLength=12000,readOnly=false}:{value:string;onChange:(value:string)=>void;language:string;label:string;maxLength?:number;readOnly?:boolean}){
 const [theme,setTheme]=useState<'light'|'dark'>(()=>document.documentElement.dataset.theme==='light'?'light':'dark');
 useEffect(()=>{const observer=new MutationObserver(()=>setTheme(document.documentElement.dataset.theme==='light'?'light':'dark'));observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();},[]);
 const [syntax,setSyntax]=useState<Extensions>([]);
 useEffect(()=>{let live=true;setSyntax([]);void languageExtensions(language).then(value=>{if(live)setSyntax(value);}).catch(()=>{});return()=>{live=false;};},[language]);
 const extensions=useMemo(()=>[...syntax,EditorView.contentAttributes.of({'aria-label':label,'aria-multiline':'true'}),EditorView.lineWrapping],[syntax,label]);
 return <div className="study-code-editor"><div><span>{language||'Plain text'}</span><small>Tab moves to the next control</small></div><CodeMirror value={value} minHeight="170px" maxHeight="420px" extensions={extensions} theme={theme} indentWithTab={false} readOnly={readOnly} basicSetup={{autocompletion:false,foldGutter:false,highlightActiveLine:!readOnly}} onChange={v=>{if(v.length<=maxLength)onChange(v);}}/><small>{value.length}/{maxLength} characters · Code is never executed here.</small></div>;
}
