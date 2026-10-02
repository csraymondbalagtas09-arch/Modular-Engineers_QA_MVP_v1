"""Ingest assessment PDFs with rotation-aware rows, sheet metadata and wall facts.
Usage: python scripts/ingest_pack.py --input /path/to/pack
PyMuPDF is required. Source PDFs are confidential; this project's Site is private.

Document type, family and the status/revision/date written here come from the
numbered assessment filenames and are provisional labels only. At runtime,
lib/register.ts re-derives package revision, issue date and current/superseded
status from each drawing register (STR000 / A000), cross-checks every title block,
and flags any disagreement with these labels as ambiguous.
"""
import argparse, hashlib, json, re, shutil
from pathlib import Path
import fitz

ROOT=Path(__file__).resolve().parents[1]

def rows_for(p):
    words=[]; seen=set()
    for x0,y0,x1,y1,text,*_ in p.get_text('words'):
        r=fitz.Rect(x0,y0,x1,y1)*p.rotation_matrix
        key=(round(r.x0,1),round(r.y0,1),text)
        if key not in seen:
            seen.add(key); words.append((r.x0,r.y0,r.x1,r.y1,text))
    words.sort(key=lambda w:(round((w[1]+w[3])/2,1),w[0]))
    rows=[]
    for w in words:
        cy=(w[1]+w[3])/2
        if not rows or abs(rows[-1]['y']-cy)>2.1: rows.append({'y':cy,'words':[]})
        rows[-1]['words'].append(w)
    for row in rows:
        row['words'].sort(key=lambda w:w[0])
        row['text']=' '.join(w[4] for w in row['words'])
    return rows,words

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--input',required=True); args=ap.parse_args()
    inp=Path(args.input); documents=[]; pages=[]; facts=[]; chunks=[]
    labels=['Assessment brief','Architectural drawings','Structural · superseded','Structural · current','Design certificate','QA checklist','Assessment questions']
    types=['Brief','Architecture','Structure','Structure','Certificate','Policy','Questions']
    previews={'00':[1], '01':[1,3,21,22], '02':[1,5,14,21], '03':[1,2,5,13,14,20,21,22], '04':[1], '05':[1], '06':[1]}
    for f in sorted(inp.glob('0[0-6]_*.pdf')):
        key=f.name[:2]; num=int(key); docid='doc-'+key; raw=f.read_bytes();d=fitz.open(f)
        status='superseded' if key=='02' else 'current' if key in ['01','03','04'] else 'reference'
        rev={'01':'CC-A','02':'D','03':'E','04':'E'}.get(key,'—')
        date={'01':'2026-09-02','02':'2026-09-08','03':'2026-09-10'}.get(key,'')
        documents.append({'id':docid,'filename':f.name,'title':labels[num],'type':types[num],'revision':rev,'issueDate':date,'status':status,'pageCount':len(d),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'url':'/project-files/'+f.name,'extraction':'Native PDF text; rotation-aware rows','family':'structural-175-2026' if key in ['02','03'] else docid})
        shutil.copy2(f,ROOT/'public/project-files'/f.name)
        for i,p in enumerate(d):
            n=i+1;rows,words=rows_for(p); w,h=p.rect.width,p.rect.height
            sheet=''
            candidates=[v for x,y,xx,yy,v in words if x>w*.84 and y>h*.80 and re.fullmatch(r'(?:STR\d{3}|A\d{3})',v)]
            if candidates: sheet=candidates[-1]
            sheetrev=rev
            if key in ['02','03']:
                candidates=[v for x,y,xx,yy,v in words if x>w*.90 and y>h*.93 and re.fullmatch('[A-Z]',v)]
                if candidates:sheetrev=candidates[-1]
            text='\n'.join(r['text'] for r in rows)
            pid=f'{docid}-p{n}'
            preview=f'/evidence/{key}-{n}.webp' if n in previews[key] else ''
            if preview: p.get_pixmap(matrix=fitz.Matrix(1.5,1.5)).pil_save(ROOT/'public'/preview.lstrip('/'),format='WEBP',quality=85)
            pages.append({'id':pid,'documentId':docid,'page':n,'sheet':sheet,'sheetRevision':sheetrev,'text':text,'preview':preview})
            # Schedule values stay associated by visual row, not raw PDF reading order.
            for row in rows:
                for m in re.finditer(r'\b(GW\d|\dW\d)\s+(RITEK WALL|CONCRETE WALL)\s+(\d{2,3})\b',row['text']):
                    facts.append({'id':f'{pid}-{m[1]}','documentId':docid,'pageId':pid,'page':n,'sheet':sheet,'sheetRevision':sheetrev,'entity':m[1],'description':m[2],'thickness':int(m[3]),'evidence':row['text'],'bbox':[0,max(0,row['y']-8),w,min(h,row['y']+8)]})
            # Bounded overlapping row windows preserve nearby context and stable page citations.
            lines=text.splitlines()
            for start in range(0,len(lines),8):
                excerpt='\n'.join(lines[start:start+12])
                if len(excerpt.strip())<25:continue
                chunks.append({'id':f'{pid}-c{start}','documentId':docid,'pageId':pid,'page':n,'sheet':sheet,'sheetRevision':sheetrev,'text':excerpt[:4500]})
    out={'documents':documents,'pages':pages,'facts':facts,'chunks':chunks}
    (ROOT/'lib/data/pack.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')))
    print(json.dumps({'documents':len(documents),'pages':len(pages),'chunks':len(chunks),'wallFacts':len(facts),'dataBytes':(ROOT/'lib/data/pack.json').stat().st_size}))
    for f in facts:
        if f['entity']=='GW1': print(f)
if __name__=='__main__':main()
