import requests,re,concurrent.futures,pathlib,base64
from bs4 import BeautifulSoup
root=pathlib.Path('/home/user/original')
soup=BeautifulSoup((root/'source.html').read_text(),'html.parser')
base='https://kopeikino.ru'
def get(url):
 try:
  r=requests.get(url,timeout=25);r.raise_for_status();return r
 except Exception:return None
def embedcss(url):
 r=get(url)
 if r is None:return ''
 def sub(m):
  u=m.group(1).strip(' "\'')
  if u.startswith('data:'):return m.group(0)
  from urllib.parse import urljoin
  rr=get(urljoin(url,u))
  if rr is None:return m.group(0)
  mime=rr.headers.get('Content-Type','font/woff2').split(';')[0]
  return 'url(data:'+mime+';base64,'+base64.b64encode(rr.content).decode()+')'
 return re.sub(r'url\(([^)]+)\)',sub,r.text)
links=list(soup.select('link[rel="stylesheet"]'))
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
 css=list(ex.map(lambda l:embedcss(base+l['href'] if l['href'].startswith('/') else l['href']),links))
for l,c in zip(links,css):
 tag=soup.new_tag('style');tag.string=c;l.replace_with(tag)
imgs=list(soup.find_all('img'))
def image(img):
 src=img.get('src','')
 if 'yandex' in src or 'mail.ru/counter' in src:img.decompose();return
 r=get(base+src if src.startswith('/') else src)
 if r is not None:img['src']='data:'+r.headers.get('Content-Type','image/webp').split(';')[0]+';base64,'+base64.b64encode(r.content).decode()
 img.attrs.pop('srcset',None)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:list(ex.map(image,imgs))
for el in soup.find_all('script'):el.decompose()
for el in soup.find_all('link'):
 if any(x in el.get('rel',[]) for x in ['preload','manifest','icon','apple-touch-icon','shortcut']):el.decompose()
for a in soup.find_all('a',href=True):
 if a['href'].startswith('/'):a['href']=base+a['href']
soup.html['class']='light'
script=soup.new_tag('script');script.string='''document.querySelectorAll('button[aria-label="Переключить тему"]').forEach(b=>{b.disabled=false;b.onclick=()=>document.documentElement.classList.toggle('dark')});''';soup.body.append(script)
(root/'index.html').write_text(str(soup))
print('Saved original page:',(root/'index.html').stat().st_size)
