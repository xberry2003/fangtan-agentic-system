"""Extract local material text without executing embedded content."""
from pathlib import Path
from fastapi import HTTPException


def extract_text(path: Path, name: str) -> str:
    suffix=Path(name).suffix.lower()
    if path.stat().st_size > 30*1024*1024:
        raise HTTPException(413,'文字提取单文件上限为30MB，请先拆分材料')
    try:
        if suffix in {'.md','.txt','.csv','.json','.srt','.vtt'}:
            raw=path.read_bytes()
            try:text=raw.decode('utf-8-sig')
            except UnicodeDecodeError:text=raw.decode('gb18030')
        elif suffix=='.docx':
            from zipfile import ZipFile
            with ZipFile(path) as archive:
                if sum(item.file_size for item in archive.infolist())>60*1024*1024:
                    raise HTTPException(413,'Word解压后内容过大，请先拆分')
            from docx import Document
            document=Document(path)
            parts=[]
            for block in document.iter_inner_content():
                if hasattr(block,'text'):parts.append(block.text)
                else:
                    parts.extend(' | '.join(cell.text for cell in row.cells) for row in block.rows)
            text='\n'.join(parts)
        elif suffix=='.pdf':
            from pypdf import PdfReader
            reader=PdfReader(path)
            if reader.is_encrypted:raise HTTPException(415,'请先解密PDF再上传')
            if len(reader.pages)>200:raise HTTPException(413,'PDF超过200页，请先拆分')
            parts=[]
            length=0
            for page in reader.pages:
                part=page.extract_text() or ''
                length+=len(part)
                if length>100000:raise HTTPException(413,'材料文字超过10万字，请先拆分，未截断读取')
                parts.append(part)
            text='\n'.join(parts)
        else:
            raise HTTPException(415,'可读取TXT、Markdown、CSV、JSON、字幕、DOCX和文字型PDF；旧版DOC需转换，图片或扫描PDF需先转成文字，音频需先转写')
    except HTTPException:raise
    except Exception as exc:raise HTTPException(415,'无法提取材料文字，请检查文件格式或转换成TXT后重试') from exc
    if not text.strip():raise HTTPException(415,'未提取到文字，扫描PDF或图片请先完成OCR')
    if len(text)>100000:raise HTTPException(413,'材料文字超过10万字，请先拆分，未截断读取')
    return text
