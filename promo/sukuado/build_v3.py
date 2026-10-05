# スクアド プロモ v3 組み立て（Higgsfield sandbox で実行）
# 入力: c1,c3,c4,c5,c6.mp4 (Kling) / rec.mp4 (画面録画20-00-51) / font.otf (Noto Sans CJK JP Bold)
import subprocess, sys
from PIL import Image, ImageDraw, ImageFont
W,H=1080,1920
F="font.otf"
DARK=(34,34,34); PINK=(232,160,188); BEIGE=(244,242,238); HP=(205,95,135); WHITE=(255,255,255); GRAY=(150,146,140)
def f(s): return ImageFont.truetype(F,s)
def run(c):
    r=subprocess.run(c,capture_output=True,text=True)
    if r.returncode: print(" ".join(c)); print(r.stderr[-1500:]); sys.exit(1)
def ctext(d,t,y,fo,fill,stroke=0,sf=None):
    tw=d.textlength(t,font=fo); d.text(((W-tw)/2,y),t,font=fo,fill=fill,stroke_width=stroke,stroke_fill=sf)
def cap(lines,name,y=300,size=64,sub=None):
    im=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(im); fo=f(size)
    tw=max(d.textlength(l,font=fo) for l in lines); pw=int(tw+90); ph=int(len(lines)*(size+14)-14+56); x0=(W-pw)//2
    d.rounded_rectangle([x0,y,x0+pw,y+ph],radius=40,fill=(255,255,255,235))
    ty=y+22
    for l in lines: ctext(d,l,ty,fo,DARK); ty+=size+14
    if sub: ctext(d,sub,1660,f(30),WHITE,2,(0,0,0))
    im.save(name)
def hook():
    im=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(im)
    ctext(d,"2回誘って、2回断られた。",250,f(70),WHITE,6,(0,0,0))
    ctext(d,"これって脈なし？",350,f(104),(255,190,215),7,(60,20,40))
    ctext(d,"※演出・AI生成映像です",1660,f(30),WHITE,2,(0,0,0))
    im.save("o1.png")
def chat():
    img=Image.new("RGB",(W,H),BEIGE); d=ImageDraw.Draw(img); fm=f(54); ft=f(30)
    ctext(d,"「また落ち着いたら連絡するね」",240,f(58),DARK)
    ctext(d,"…これ、どういう意味？",330,f(58),HP)
    y=480; prev=None
    items=[("今度の土曜日、\nご飯行かない？","R","20:10"),("ごめん、\n今ちょっと忙しくて","L","22:30"),("そっか！\nじゃあ来週は？","R","22:34"),("来週もバタバタ\nしそうなんだよね","L","23:20"),("また落ち着いたら\n連絡するね","L","23:21")]
    for i,(t,s,tm) in enumerate(items):
        ls=t.split("\n"); lh=68; tw=max(d.textlength(l,font=fm) for l in ls); bw=int(tw+88); bh=len(ls)*lh-14+68
        if s=="L":
            x0=198
            if prev!="L":
                d.ellipse([70,y,174,y+104],fill=(205,201,195)); cx=122
                d.ellipse([cx-17,y+24,cx+17,y+58],fill=(245,243,240)); d.pieslice([cx-32,y+62,cx+32,y+126],180,360,fill=(245,243,240))
            fill=WHITE
        else: x0=W-70-bw; fill=PINK
        d.rounded_rectangle([x0,y,x0+bw,y+bh],radius=46,fill=fill)
        if i==len(items)-1: d.rounded_rectangle([x0-8,y-8,x0+bw+8,y+bh+8],radius=52,outline=HP,width=8)
        ty=y+28
        for l in ls: d.text((x0+44,ty),l,font=fm,fill=DARK); ty+=lh
        tmw=d.textlength(tm,font=ft)
        d.text(((x0+bw+18) if s=="L" else (x0-18-tmw), y+bh-40),tm,font=ft,fill=GRAY)
        y+=bh+40; prev=s
    ctext(d,"※サンプル会話です",1660,f(30),GRAY)
    img.save("chat.png")
def end():
    im=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rectangle([0,0,W,760],fill=(255,248,250,215))
    ctext(d,"スクアド",170,f(150),DARK)
    ctext(d,"声でも文字でも、気軽に相談",370,f(48),(90,80,85))
    ctext(d,"迷ったら、スクアドに聞いてみよう",470,f(62),HP)
    pill="プロフのリンクから"; fo=f(54); tw=d.textlength(pill,font=fo); pw=int(tw+110); x0=(W-pw)//2
    d.rounded_rectangle([x0,590,x0+pw,700],radius=55,fill=HP); ctext(d,pill,610,fo,WHITE)
    ctext(d,"※演出・AI生成映像です。AIの回答は一例です。",1660,f(30),WHITE,2,(0,0,0))
    im.save("o7.png")
hook(); chat(); end()
cap(["なんて返せばいいの…"],"o3.png")
cap(["スクショを送るだけ"],"o4.png")
def rec_cap():
    # 画面録画シーン: アプリ上部を帯で隠し、その上に字幕
    im=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rectangle([0,0,W,330],fill=BEIGE+(255,))
    lines=["相手の温度感まで","教えてくれる"]; fo=f(58)
    tw=max(d.textlength(l,font=fo) for l in lines); pw=int(tw+90); x0=(W-pw)//2
    d.rounded_rectangle([x0,40,x0+pw,40+2*72-14+56],radius=40,fill=PINK)
    y=62
    for l in lines: ctext(d,l,y,fo,DARK); y+=72
    ctext(d,"※AIの回答は一例です",280,f(30),(120,116,110))
    im.save("o5.png")
rec_cap()
cap(["そういうことか…！"],"o6.png")
Image.new("RGBA",(W,H),(0,0,0,0)).save("o0.png")
BR="eq=brightness=0.03:gamma=1.07"   # 明るさ+約7%（PROMPT_RULES.md）
ENC=["-c:v","libx264","-preset","medium","-crf","19","-pix_fmt","yuv420p","-r","30","-an"]
def seg(src,ss,dur,ov,out,extra="",speed=1.0,still=False,crop=None):
    inp=["-loop","1","-t",str(dur),"-i",src] if still else ["-ss",str(ss),"-t",str(dur*speed),"-i",src]
    vf=(crop+"," if crop else "")+f"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1{extra}"
    if speed!=1.0: vf+=f",setpts=PTS/{speed}"
    vf+=",fps=30"
    run(["ffmpeg","-v","error","-y"]+inp+["-loop","1","-i",ov,"-filter_complex",f"[0:v]{vf}[v];[v][1:v]overlay=0:0[o]","-map","[o]","-t",f"{dur}"]+ENC+[out])
seg("c1.mp4",0.4,2.6,"o1.png","s1.mp4",","+BR+",eq=gamma=1.06")   # 寝室は暗いので追加補正
seg("chat.png",0,2.4,"o0.png","s2.mp4",still=True)
seg("c3.mp4",0.5,2.2,"o3.png","s3.mp4",","+BR+",eq=gamma=1.06")
seg("c4.mp4",1.0,2.4,"o4.png","s4.mp4",","+BR)
seg("rec.mp4",0.0,4.0,"o5.png","s5.mp4",speed=1.35,crop="crop=1206:2144:0:190")
seg("c5.mp4",0.8,3.0,"o6.png","s6.mp4",","+BR)
seg("c6.mp4",0.5,3.6,"o7.png","s7.mp4",","+BR)
open("list.txt","w").write("".join(f"file 's{i}.mp4'\n" for i in range(1,8)))
run(["ffmpeg","-v","error","-y","-f","concat","-safe","0","-i","list.txt","-f","lavfi","-t","20.2","-i","anullsrc=r=44100:cl=stereo","-c:v","copy","-c:a","aac","-shortest","-movflags","+faststart","sukuado_promo_v3.mp4"])
print("done")
