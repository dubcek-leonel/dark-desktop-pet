from playwright.sync_api import sync_playwright
from pathlib import Path
from urllib.parse import urlsplit
import mimetypes

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,channel='msedge')
    page=browser.new_page(viewport={'width':256,'height':256})
    page.add_init_script("window.sent=[];window.api={on:()=>{},send:(...a)=>sent.push(a)}")
    root=Path(__file__).resolve().parents[1]/'out'/'renderer'
    def serve(route):
        target=root/urlsplit(route.request.url).path.lstrip('/')
        route.fulfill(body=target.read_bytes(),content_type=mimetypes.guess_type(target)[0] or 'application/octet-stream')
    page.route('http://localhost:8765/**',serve)
    page.goto('http://localhost:8765/index.html')
    page.wait_for_load_state('networkidle')
    page.wait_for_function("Array.from(document.querySelector('canvas').getContext('2d').getImageData(0,0,256,256).data).some(x=>x>0)")
    point=page.evaluate("""()=>{const c=document.querySelector('canvas').getContext('2d');for(let y=130;y<210;y+=5)for(let x=100;x<160;x+=5)if(c.getImageData(x,y,1,1).data[3]>200)return {x,y};} """)
    assert point
    page.mouse.click(point['x'],point['y'])
    page.wait_for_timeout(300)
    assert page.evaluate("sent.filter(x=>x[0]==='pet:click').length") == 1
    page.evaluate('sent=[]')
    page.mouse.dblclick(point['x'],point['y'],delay=50)
    page.wait_for_timeout(300)
    assert page.evaluate("sent.filter(x=>x[0]==='pet:dblclick').length") == 1
    assert not page.evaluate("sent.some(x=>x[0]==='pet:click')")
    page.evaluate('sent=[]')
    page.mouse.move(point['x'],point['y'])
    page.mouse.down()
    page.mouse.move(point['x']+50,point['y']-30,steps=3)
    page.mouse.up()
    assert page.evaluate("sent.some(x=>x[0]==='pet:dragStart')")
    offset=page.evaluate("sent.find(x=>x[0]==='pet:dragStart')[1]")
    assert abs(offset['offsetX']-point['x'])<1 and abs(offset['offsetY']-point['y'])<1
    assert page.evaluate("sent.some(x=>x[0]==='pet:dragEnd')")
    assert not page.evaluate("sent.some(x=>x[0]==='pet:click')")
    page.evaluate('sent=[]')
    page.mouse.click(1,1,button='right')
    assert not page.evaluate("sent.some(x=>x[0]==='pet:contextmenu')")
    page.mouse.click(point['x'],point['y'],button='right')
    assert page.evaluate("sent.some(x=>x[0]==='pet:contextmenu')")
    print('Pet gestures passed: single greeting, double animation, stable drag grip, release and opaque-only context menu.')
    browser.close()
