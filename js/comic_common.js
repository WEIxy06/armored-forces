
/* ===== Module: comic_common.js ===== */
/* ============================================================
   模块: comic_common.js — comic 通用工具(烟团扩张曲线/面向相机/爆炸时间线)
   (本模块通用部分,须先于 comic.js 加载;加载顺序由 index.html MODULES 表决定)
   ============================================================ */
'use strict';
/* 通用漫画烟雾扩散曲线:所有炮口烟、命中烟、发动机烟、履带尘、火箭尾迹/爆炸烟共用。
   参数仅决定淡入、最大倍率、扩散速度、尾段衰减、上升和阻力;返回复用 scratch,零分配。 */
var _comicSmokeE={k:0,scale:1,alpha:0,rise:0,drift:0};

function comicSmokeExpand(age,life,fadeIn,maxScale,growPow,fadePow,riseMax,drag){
  var E=_comicSmokeE,k=clamp(age/Math.max(.001,life),0,1);E.k=k;E.scale=1+(maxScale-1)*Math.pow(k,growPow);
  E.alpha=Math.min(1,k/Math.max(.001,fadeIn))*Math.pow(Math.max(0,1-k),fadePow);E.rise=riseMax*(1-Math.exp(-3*k));
  E.drift=drag>0?(1-Math.exp(-drag*age))/drag:age;return E;
}

/* 通用贴图相机面向函数:所有漫画贴图旋转统一走这里。
   YAW 只绕世界竖轴(履带尘/发动机烟/喷射团烟/爆炸面),CAMERA 用于必须完整面向镜头的闪光面。 */
var COMIC_FACE_YAW=0,COMIC_FACE_CAMERA=1,_comicFaceY=new THREE.Vector3(0,1,0);

function comicTextureFace(out,x,y,z,mode,camObj){var cam=camObj||(typeof camera!=='undefined'?camera:null);if(!out)return 0;if(!cam){out.identity();return 0;}if(mode===COMIC_FACE_CAMERA){out.copy(cam.quaternion);return 0;}var dx=cam.position.x-x,dz=cam.position.z-z,yaw=dx*dx+dz*dz>.000001?Math.atan2(dx,dz):0;out.setFromAxisAngle(_comicFaceY,yaw);return yaw;}

/* 通用爆炸出现时序:火光爆开/停留/淡出与随后烟雾延迟统一参数化,火箭和载具爆炸共用。 */
var COMIC_EXP_ROCKET={fireGrow:.20,fireHold:1.05,fireFade:.42,smokeDelay:0,smokeLife:2.72};   // 火箭:烟与火光同帧出现(smokeDelay 0),烟寿命补回延迟量(总时长 2.72s 不变)

var COMIC_EXP_VEHICLE={fireGrow:.24,fireHold:1.05,fireFade:.85,smokeDelay:.46,smokeLife:2.24};

var _comicExplosionP={fireK:0,fireAlpha:0,smokeAge:0,smokeOn:false};

function comicExplosionTimeline(t,cfg){var P=_comicExplosionP;P.fireK=clamp(t/Math.max(.001,cfg.fireGrow),0,1);P.fireAlpha=t<=cfg.fireHold?1:Math.max(0,1-(t-cfg.fireHold)/Math.max(.001,cfg.fireFade));P.smokeAge=Math.max(0,t-cfg.smokeDelay);P.smokeOn=t>=cfg.smokeDelay&&P.smokeAge<cfg.smokeLife;return P;}

/* ===== 炮镜原生尺寸口径(全项目唯一实现;消费者:爆点两池/持续燃烧/战术标识+爆点入场硬裁剪) ----
   炮镜内=1(整屏光学变倍统一作用于场景,任何贴图特效绝不叠加距离补偿);
   第三人称=距离图标化补偿 clamp(√d²/ref,min,max)(屏幕投影近似恒定,远景可读)。
   收 d² 而非 d:sqrt 只在非镜分支发生,炮镜状态下全部消费点零开方。 ===== */
function scopeDistK(sn, d2, ref, min, max) {
  return sn ? 1 : clamp(Math.sqrt(d2) / ref, min, max);
}
/* 2km 硬距可见性(镜内直通):特效活跃可见门与入场硬裁剪共用(!scopeFarVisible=裁掉) */
function scopeFarVisible(sn, d2) {
  return sn || d2 <= 4000000;
}

