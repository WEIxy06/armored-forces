/* Simplified-Chinese UI localization layer.  Game logic and vehicle physics remain unchanged. */
(function () {
  'use strict';

  var VEHICLE_RULES = [
    [/\bRED[-_ ]?MBT[-_ ]?1\b/gi, '59式'],
    [/\bRED[-_ ]?MBT[-_ ]?2\b/gi, '99式'],
    [/\bRED[-_ ]?TD\b/gi, 'PTZ-89'],
    [/\bRED[-_ ]?(?:HELI|ATTACK HELI|ATTACK HELICOPTER)\b/gi, 'WZ-10'],
    [/\bRED[-_ ]?(?:MLRS|ROCKET ARTILLERY|MULTIPLE LAUNCH ROCKET SYSTEM)\b/gi, 'PHL-11'],
    [/\bRED[-_ ]?(?:AA|AIR DEFENSE)\b/gi, 'PGZ-95'],
    [/\bBLUE[-_ ]?MBT[-_ ]?1\b/gi, 'M60'],
    [/\bBLUE[-_ ]?MBT[-_ ]?2\b/gi, 'M1A1'],
    [/\bBLUE[-_ ]?(?:HELI|ATTACK HELI|ATTACK HELICOPTER)\b/gi, 'AH-64D'],
    [/\bBLUE[-_ ]?(?:MLRS|ROCKET ARTILLERY|MULTIPLE LAUNCH ROCKET SYSTEM)\b/gi, 'M124'],
    [/\bBLUE[-_ ]?(?:AA|AIR DEFENSE)\b/gi, '蓝方防空车']
  ];

  /* Longer phrases are applied before individual words. */
  var PHRASES = [
    ['Armored Corps', '装甲军团'],
    ['RED-HEAVY MBT', '99式'],
    ['RED-MEDIUM TANK', '59式'],
    ['RED-TANK DESTROYER', 'PTZ-89'],
    ['RED-ATTACK HELI', 'WZ-10'],
    ['RED-ATTACK HELICOPTER', 'WZ-10'],
    ['RED-ROCKET ARTILLERY', 'PHL-11'],
    ['RED-AIR DEFENSE', 'PGZ-95'],
    ['BLUE-HEAVY MBT', 'M1A1'],
    ['BLUE-MEDIUM TANK', 'M60'],
    ['BLUE-ATTACK HELI', 'AH-64D'],
    ['BLUE-ATTACK HELICOPTER', 'AH-64D'],
    ['BLUE-ROCKET ARTILLERY', 'M124'],
    ['BLUE-AIR DEFENSE', '蓝方防空车'],
    ['RED HEAVY MBT', '99式'],
    ['BLUE HEAVY MBT', 'M1A1'],
    ['RED MEDIUM TANK', '59式'],
    ['BLUE MEDIUM TANK', 'M60'],
    ['TACTICAL SYSTEM // INITIALIZING', '战术系统 // 初始化'],
    ['LOADING ASSETS & COMPILED SHADERS...', '正在加载资源与编译着色器...'],
    ['SYSTEM READY // LAUNCHING...', '系统就绪 // 启动中...'],
    ['POWER OFF', '断电'],
    ['STARTING', '启动中'],
    ['WARMUP', '预热中'],
    ['ACTIVATING…', '激活中……'],
    ['CALIBRATING BALLISTICS & AUDIO DSP...', '正在校准弹道与音频处理...'],
    ['COMPILING SHADERS & PROCEDURAL TERRAIN...', '正在编译着色器与程序化地形...'],
    ['PARSING VEHICLE BLUEPRINTS & TEXTURES...', '正在解析载具蓝图与纹理...'],
    ['PREVIEWING FX SHADERS...', '正在预热特效着色器...'],
    ['INITIALIZING HANGAR // PREPARING VEHICLES...', '正在初始化机库 // 准备载具...'],
    ['COMMANDER HAS PLANNED THE BATTLEFIELD FOCUS', '指挥官已规划战场重点'],
    ['COMMANDER HAS REPLANNED THE BATTLEFIELD FOCUS', '指挥官已重新规划战场重点'],
    ['TEAM DEATHMATCH', '团队死斗'],
    ['FREE-FOR-ALL', '自由混战'],
    ['TO BATTLE', '开始战斗'],
    ['CUSTOM MISSION & WEATHER SETTINGS', '自定义任务与天气设置'],
    ['CUSTOM MISSION', '自定义任务'],
    ['COMBAT READY', '战斗就绪'],
    ['TACTICAL HANGAR', '战术机库'],
    ['TACTICAL MAP // TOP VIEW', '战术地图 // 俯视图'],
    ['TACTICAL PANEL', '战术面板'],
    ['TACTICAL BIOS', '战术 BIOS'],
    ['TACTICAL SYSTEM', '战术系统'],
    ['BATTLEFIELD REPAIR', '战场维修'],
    ['BATTLEFIELD REPAIR // ', '战场维修 // '],
    ['CONTROL ZONE // STOPPED', '控制区 // 已停止'],
    ['CONTROL ZONE // READY', '控制区 // 就绪'],
    ['CONTROL ZONE // ', '控制区 // '],
    ['CAPTURE PAUSED // ', '占领暂停 // '],
    ['REPAIR PREP // STOPPED', '维修准备 // 已停止'],
    ['REPAIR IN 5.0s', '将在 5.0 秒后维修'],
    ['REPAIR IN 10S', '将在 10 秒后维修'],
    ['ETA // ', '预计时间 // '],
    ['ZONE: N/A', '区域：无'],
    ['ZONE: STANDBY', '区域：待机'],
    ['EVENT LINK // FIRE / LOSS', '事件链路 // 开火 / 损失'],
    ['LEAVING COMBAT ZONE · RETURN NOW', '正在离开战区 · 立即返回'],
    ['INCOMING MISSILE', '来袭导弹'],
    ['TARGET DESTROYED!', '目标已摧毁！'],
    ['NO VALID AIMPOINT', '没有有效瞄准点'],
    ['AIM TOO CLOSE, MIN RANGE 35M', '目标过近，最小距离 35 米'],
    ['NO GUN EQUIPPED', '未装备火炮'],
    ['CANNOT FIRE', '无法开火'],
    ['AMMO RACK DAMAGED - HOLD FIRE', '弹药架受损 - 暂停开火'],
    ['MISSILE RACK DAMAGED - HOLD FIRE', '导弹架受损 - 暂停开火'],
    ['LAUNCHER DAMAGED - HOLD FIRE', '发射架受损 - 暂停开火'],
    ['DECOY FLARES DEPLOYED', '诱饵弹已释放'],
    ['DECOY FLARES EMPTY', '诱饵弹耗尽'],
    ['DEFEAT! ELIMINATED', '失败！已被淘汰'],
    ['DEFEAT!', '失败！'],
    ['LAST SURVIVOR', '最后幸存者'],
    ['MUTUAL KILL', '同归于尽'],
    ['OUT OF FORCES', '兵力耗尽'],
    ['NO RESERVE VEHICLES', '没有预备载具'],
    ['NO VEHICLES IN PLAY', '没有在场载具'],
    ['NO STRENGTH - NO DEPLOY', '没有兵力 - 无法部署'],
    ['NO SQUAD AVAILABLE', '没有可用小队'],
    ['NO REPAIRABLE MODULE', '没有可维修模块'],
    ['STOP TO REPAIR', '停车维修'],
    ['AWAITING DAMAGE', '等待受损'],
    ['ENGINE SHUTDOWN (POWER OFF)', '发动机关闭（断电）'],
    ['ENGINE STARTING', '发动机启动中'],
    ['POWERING UP', '通电中'],
    ['POWER OFF', '断电'],
    ['NORMAL RELOAD // FATIGUED', '正常装填 // 疲劳'],
    ['SUPER RELOAD ×2 // BURST LOADING', '超级装填 ×2 // 连发装填'],
    ['BURST LOADING', '连发装填'],
    ['COMMAND MODE', '指挥模式'],
    ['COMMAND MODE (A SHOOTS, B GUIDES)', '指挥模式（A 射击，B 引导）'],
    ['WEAPON [1]: MAIN GUN', '武器 [1]：主炮'],
    ['WEAPON [1]: AP ROUND', '武器 [1]：穿甲弹'],
    ['WEAPON [1]: MISSILE', '武器 [1]：导弹'],
    ['WEAPON [1]: SAM', '武器 [1]：地空导弹'],
    ['WEAPON [2]: GUN-LAUNCHED MISSILE', '武器 [2]：炮射导弹'],
    ['WEAPON [2]: HIGH-EXPLOSIVE', '武器 [2]：高爆弹'],
    ['WEAPON [2]: ATGM', '武器 [2]：反坦克导弹'],
    ['WEAPON [2]: ROCKETS', '武器 [2]：火箭弹'],
    ['WEAPON [2]: TWIN GUN', '武器 [2]：双联机炮'],
    ['WEAPON [3]: TWIN GUN', '武器 [3]：双联机炮'],
    ['WEAPON [3]: GUN', '武器 [3]：机炮'],
    ['TACTICAL MAP', '战术地图'],
    ['CONTROL ZONE', '控制区'],
    ['COMMANDER', '指挥官'],
    ['RANGE --- m', '距离 --- 米'],
    ['AZ: 00°  EL: 00°', '方位：00°  仰角：00°'],
    ['TGT: NONE', '目标：无'],
    ['FCR: STANDBY', '火控雷达：待机'],
    ['FCR: WARMING UP', '火控雷达：预热中'],
    ['FIREPOWER', '火力'],
    ['PROTECTION', '防护'],
    ['MOBILITY', '机动'],
    ['OPTICS & FCS', '光学与火控'],
    ['125mm smoothbore gun', '125毫米滑膛炮'],
    ['Heavy composite + ERA', '重型复合装甲 + 爆炸反应装甲'],
    ['Thermal / Laser suppressor', '热成像 / 激光压制器'],
    ['Vehicle Bay Index', '载具库索引'],
    ['Vehicle Bay', '载具库'],
    ['Vehicle Levels', '载具等级'],
    ['TECH DATA PENDING', '技术数据待定'],
    ['AVAILABLE EXPERIENCE', '可用经验'],
    ['ACHIEVEMENT INDEX', '成就索引'],
    ['ACHIEVEMENT PROTOCOL', '成就协议'],
    ['COMMENDATIONS / FIELD RECORDS / ARCHIVE SCHEMA 03', '嘉奖 / 战场记录 / 档案架构 03'],
    ['PERSONNEL RECORD // LOCAL ARCHIVE', '人员记录 // 本地档案'],
    ['LOCAL ARCHIVE // READY', '本地档案 // 就绪'],
    ['LOCAL ARCHIVE', '本地档案'],
    ['DATABASE ONLINE', '数据库在线'],
    ['RECORDS UPDATED', '记录已更新'],
    ['NO VEHICLE TYPES REGISTERED', '未注册载具类型'],
    ['CURRENT DEPLOYMENT', '当前部署'],
    ['ONE LIFE RECORD', '单局生存记录'],
    ['LONGEST CONFIRMED KILL', '最远确认击杀'],
    ['DESTROYED BY VEHICLE', '按载具统计的摧毁数'],
    ['SORTIES BY VEHICLE', '按载具统计的出击数'],
    ['PLAYER DATA // DEVICE STORAGE ONLY', '玩家数据 // 仅保存在本设备'],
    ['GAME SETTINGS', '游戏设置'],
    ['SYSTEM & VISUALS', '系统与画面'],
    ['CONTROLS GUIDE (KEYBOARD & MOUSE)', '操作指南（键盘与鼠标）'],
    ['PC CONTROLS', '电脑端操作'],
    ['DATA WIPE PROTOCOL', '数据清除协议'],
    ['THIS WILL CLEAR ALL STATISTICS AND UNLOCKED UPGRADES!', '这将清除所有统计数据和已解锁升级！'],
    ['PAUSED // COMBAT PAUSED', '已暂停 // 战斗暂停'],
    ['SYSTEM HALT', '系统暂停'],
    ['RESTART TO APPLY', '重启后生效'],
    ['OVERRIDDEN BY URL PARAM', '已被网址参数覆盖'],
    ['OVERRIDDEN BY URL PARAM', '已被网址参数覆盖'],
    ['DRAG CONTROLS TO REPOSITION', '拖动控件以重新定位'],
    ['DRAG TO MOVE · HOLD + PINCH TO RESIZE', '拖动按钮移动位置 · 按住按钮后双指开合调整大小'],
    ['TOUCH CONTROLS', '触控操作'],
    ['Joystick drive / heli pad', '摇杆驾驶 / 直升机十字键'],
    ['Aim turret / camera', '瞄准炮塔 / 视角'],
    ['Two-finger pinch', '双指开合'],
    ['Sight zoom', '炮镜缩放'],
    ['Fire gun / rockets / cannon', '主炮 / 火箭 / 机炮开火'],
    ['Night vision / thermal', '夜视 / 热成像'],
    ['Squad orders', '小队指令'],
    ['Hold for laser suppress', '按住激光压制'],
    ['Tap to switch weapons', '点按切换武器'],
    ['Tap to change size', '点按切换大小'],
    ['Left thumb', '左手拇指'],
    ['Right drag', '右半屏拖动'],
    ['Weapon bar', '武器栏'],
    ['Mini-map', '小地图'],
    ['M: CYCLE', 'M：循环切换'],
    ['TOP LEFT (DEFAULT)', '左上（默认）'],
    ['SMALL (DEFAULT)', '小（默认）'],
    ['FIRE / LOSS', '开火 / 损失'],
    ['HANGER', '机库'],
    ['HANGAR', '机库'],
    ['HANGAR // VEHICLE INSPECTION', '机库 // 载具检视'],
    ['TANK SUPPORT', '坦克支援'],
    ['ARTILLERY SUPPORT', '炮兵支援'],
    ['AIR SUPPORT', '空中支援'],
    ['STRATEGIC SUPPORT', '战略支援'],
    ['STRATEGIC BOMBARDMENT', '战略轰击'],
    ['STRATEGIC TRANSPORT', '战略运输'],
    ['AIR REINFORCEMENTS', '空中增援'],
    ['Game mode', '游戏模式'],
    ['Faction', '阵营'],
    ['Vehicle', '载具'],
    ['Time', '时间'],
    ['Map size', '地图大小'],
    ['Staging base', '集结基地'],
    ['Control zones', '控制区'],
    ['Roughness', '崎岖度'],
    ['Volume', '音量'],
    ['Music', '音乐'],
    ['CRT filter', 'CRT 滤镜'],
    ['Color grade', '色彩分级'],
    ['Mini-map position', '小地图位置'],
    ['Mini-map size', '小地图大小'],
    ['Aim sensitivity', '瞄准灵敏度'],
    ['Explosion FX', '爆炸特效'],
    ['Model quality', '模型质量'],
    ['Debug: Off', '调试：关'],
    ['FPS: On', '帧率：开'],
    ['Kill feed: On', '击杀信息：开'],
    ['Touch layout', '触控布局'],
    ['Available vehicle', '可用载具'],
    ['Active vehicles', '在场载具'],
    ['Max vehicles in play', '最大在场载具数'],
    ['Powerup density', '强化道具密度'],
    ['FREE-FOR-ALL ROSTER', '自由混战编制'],
    ['FREE-FOR-ALL STATUS', '自由混战状态'],
    ['Left click', '左键'],
    ['Right click', '右键'],
    ['Gunner sight', '炮手瞄准镜'],
    ['Zoom / heli lift', '缩放 / 直升机升降'],
    ['Radar on/off & scan', '雷达开关与扫描'],
    ['Thermal imaging (FLIR)', '热成像（FLIR）'],
    ['Night vision (NV)', '夜视（NV）'],
    ['10x precision aim', '10 倍精确瞄准'],
    ['Capture zone', '占领控制区'],
    ['Follow formation', '跟随编队'],
    ['Bail out / redeploy', '弃车 / 重部署'],
    ['Tac marker', '战术标记'],
    ['Mini-map size / toggle', '小地图大小 / 开关'],
    ['NO RECORD', '无记录'],
    ['CURRENT DEPLOYMENT', '当前部署'],
    ['RANGE --- m', '距离 --- 米'],
    ['RLD', '装填'],
    ['CAP', '占领'],
    ['Z+', '维修 +'],
    ['BATTLE OVER', '战斗结束'],
    ['ENEMY TALLY', '敌方统计'],
    ['FRIENDLY LOSSES', '友方损失'],
    ['CREWS BAILED', '弃车乘员'],
    ['FOE VEH CAPTURED', '俘获敌方载具'],
    ['FOE VEH KILLED', '摧毁敌方载具'],
    ['CREWS LOST', '损失乘员'],
    ['EXPERIENCE EARNED', '获得经验'],
    ['LOCAL RECORDS DETECTED', '检测到本地记录'],
    ['REPAIR PREP', '维修准备'],
    ['SAFE ZONE ACTIVE', '安全区生效'],
    ['SAFE ZONE ESTABLISHED', '安全区已建立'],
    ['ZONE SHRINK WARNING', '区域收缩警告'],
    ['IN BOMBARDMENT ZONE', '处于轰击区'],
    ['BOMBARDMENT ZONE', '轰击区'],
    ['AIR REINFORCEMENTS ARRIVED: +50 FORCES', '空中增援已抵达：+50 兵力'],
    ['AIR REINFORCEMENTS (+50 FORCES)', '空中增援（+50 兵力）'],
    ['TARGETS...', '目标……'],
    ['TOOK THE OBJECTIVE!', '已夺取目标点！'],
    ['TOOK OVER', '已接管'],
    ['RETURNED TO UNIT', '已返回单位'],
    ['SQUAD: FOLLOW', '小队：跟随'],
    ['SQUAD: SEIZE', '小队：夺取'],
    ['SQUAD COMMAND', '小队指挥'],
    ['RECORDS UPDATED', '记录已更新'],
    ['FINAL RANK', '最终排名'],
    ['PLAYER KILLS', '玩家击杀'],
    ['SURVIVORS LEFT', '剩余幸存者']
  ];

  /* 校对新增：上下文短语，与 PHRASES 合并后按长度降序、带字母边界匹配。 */
  var PRE = [["LEFT BASE", "左翼基地"], ["RIGHT BASE", "右翼基地"], ["CENTER BASE", "中央基地"], ["TOP LEFT", "左上"], ["TOP RIGHT", "右上"], ["BOTTOM LEFT", "左下"], ["BOTTOM RIGHT", "右下"], ["LEFT ARMOR", "左侧装甲"], ["RIGHT ARMOR", "右侧装甲"], ["LEFT PYLON RELOADED", "左挂架已装填"], ["RIGHT PYLON RELOADED", "右挂架已装填"], ["LEFT PYLON", "左挂架"], ["RIGHT PYLON", "右挂架"], ["SURVIVORS LEFT", "剩余幸存者"], ["Yaw left", "向左偏航"], ["Yaw right", "向右偏航"], ["Roll left", "向左横滚"], ["Roll right", "向右横滚"], ["Collective up", "增加总距"], ["Collective down", "降低总距"], ["Pitch forward", "前倾"], ["Pitch back", "后仰"], ["Night vision", "夜视"], ["Thermal imaging", "热成像"], ["Helicopter attitude", "直升机姿态"], ["Mouse cursor", "鼠标光标"], ["Tactical minimap", "战术小地图"], ["Strategic support progress", "战略支援进度"], ["Strategic support countdowns", "战略支援倒计时"], ["Active powerups", "当前强化"], ["Vehicle technology status", "载具技术状态"], ["Control zone capture status", "控制区占领状态"], ["Instant 1-Click Battle", "一键快速开战"], ["Inspect internals (X-Ray)", "透视内部结构（X光）"], ["Expand / collapse vehicle bay", "展开 / 收起载具库"], ["Expand / collapse vehicle levels", "展开 / 收起载具等级"], ["Game settings & manual", "游戏设置与说明"], ["Game settings and manual", "游戏设置与说明"], ["Turret · Front", "炮塔 · 正面"], ["LOS equiv", "等效厚度"], ["Close achievements", "关闭成就"], ["YES", "是"], ["LOCK ON", "锁定"], ["LOCK CANCELLED", "锁定取消"], ["DESIGNATED", "已指示"], ["WARMING UP", "预热中"], ["POWERING UP", "通电中"], ["BUILD-UP", "蓄能"], ["ROCKETS DOWN", "火箭弹失效"], ["MISSILES DOWN", "导弹失效"], ["MAIN GUN LOADING RESET", "主炮装填重置"], ["MAIN GUN", "主炮"], ["MAIN MENU", "主菜单"], ["MAIN ROTOR", "主旋翼"], ["TAIL ROTOR", "尾旋翼"], ["ROTOR", "旋翼"], ["MAIN FUEL CELL", "主油箱"], ["TAKE OVER", "接管"], ["BATTLE OVER", "战斗结束"], ["GAME OVER", "游戏结束"], ["HE ROUND", "高爆弹"], ["AP ROUND", "穿甲弹"], ["IMPROVED AP ROUND", "改进型穿甲弹"], ["IMPROVED AP", "改进穿甲弹"], ["DEPLETED URANIUM ROUND", "贫铀弹"], ["DEPLETED URANIUM ARMOR", "贫铀装甲"], ["DU ROUND", "贫铀弹"], ["DU ARMOR", "贫铀装甲"], ["DU GLACIS", "贫铀首上装甲"], ["DU COMPOSITE", "贫铀复合装甲"], ["HIGH-EXPLOSIVE ROUND", "高爆弹"], ["AIRBURST ROUND", "空爆弹"], ["AIRBURST", "空爆"], ["FIRE KILL", "起火焚毁"], ["STRUCT KILL", "结构击毁"], ["AIRSTRIKE KILL", "空袭击毁"], ["AMMO DETONATION", "弹药殉爆"], ["DEBUG KILL", "调试击毁"], ["TEST KILL", "测试击毁"], ["IGNITED", "起火"], ["DETONATION", "殉爆"], ["AIRSTRIKE", "空袭"], ["NO PEN", "未击穿"], ["NO SAME-SIDE HELI IN RANGE", "范围内没有己方直升机"], ["OPEN FIRE", "开火"], ["HOLD FIRE", "停止射击"], ["CANNOT FIRE", "无法开火"], ["direct fire", "直射火力"], ["Fire-and-forget", "发射后不管"], ["Air-to-air missiles", "空空导弹"], ["Surface-to-air missiles", "地空导弹"], ["SURFACE-TO-AIR MISSILES", "地空导弹"], ["SURFACE-TO-AIR SEEKER", "地空导引头"], ["AIR SEARCH RADAR", "对空搜索雷达"], ["Air search radar", "对空搜索雷达"], ["AIR SUPPORT", "空中支援"], ["AIR REINFORCEMENTS", "空中增援"], ["Tracked ADA escort chassis", "履带式防空伴随底盘"], ["off-road", "越野"], ["COOK-OFF RISK", "殉爆风险"], ["COOK-OFF", "殉爆"], ["HP/S", "耐久/秒"], ["SESSION CACHE // STORAGE LIMITED", "会话缓存 // 存储受限"], ["record(s) stored in the local archive.", "条记录保存在本地档案中。"], ["ALL MODULES READY", "全部模块就绪"], ["CAPTURE PAUSED", "占领暂停"], ["AMMO RACK", "弹药架"], ["LAUNCH TUBES", "发射管"], ["FEED BIN", "供弹箱"], ["MSL LAUNCHER", "导弹发射架"], ["DRY GRASSLAND", "干草原"], ["FERTILE SOIL", "沃土"], ["SANDY GOBI", "沙质戈壁"], ["SCRUB HILLS", "灌木丘陵"], ["CLIFF ROCK", "峭壁岩地"], ["HEATH HIGHLAND", "荒原高地"], ["Kill feed", "击杀播报"], ["TGT: SELF-TEST", "目标：自检"], ["RADAR PWR: NOMINAL [AUTO-START]", "雷达电源：正常 [自动启动]"], ["DATALINK", "数据链"], ["TGTS [MULTI-CH]", "目标 [多通道]"], ["RADAR NOMINAL [TWS MULTI-LOCK]", "雷达正常 [边扫边跟 多目标锁定]"], ["MULTI-TGT TRACKING", "多目标跟踪"], ["ENERGY", "能量"], ["CONTACTS", "接触目标"], ["TGTS", "目标"], ["RADAR NOMINAL [MAN STBY]", "雷达正常 [手动待机]"], ["RADAR NOMINAL [TWS AUTO]", "雷达正常 [边扫边跟 自动]"], ["RACK RELOADED", "发射架已装填"], ["RACK DAMAGED", "发射架受损"], ["ROCKETS FIRED", "火箭弹已发射"], ["MISSILES LOADING", "导弹装填中"], ["MISSILES", "导弹"], ["PYLON EMPTY", "挂架已空"], ["RACK EMPTY", "发射架已空"], ["AIM TOO CLOSE, MIN RANGE", "瞄准点过近，最小射程"], ["POINT MARKED", "已标记落点"], ["SUPER AP", "超级穿甲"], ["SUPER ARMOR", "超级装甲"], ["SUPER RELOAD", "超级装填"], ["ROCKET BOOST", "火箭加速"], ["EMERGENCY REPAIR", "紧急维修"], ["PENETRATION", "穿深"], ["EFFECTIVE ARMOR", "有效装甲"], ["GROUND ONLY", "仅限地面"], ["GUN-LAUNCHED MISSILE", "炮射导弹"], ["TWIN CANNON", "双联机炮"], ["LIMIT", "上限"], ["VEH TYPE", "载具类型"], ["REQUESTING AUTH", "请求授权"], ["SYNCING DATALINK", "同步数据链"], ["WELCOME TO THE TACTICAL PANEL", "欢迎使用战术面板"], ["BOOTING", "启动中"], ["SKIRMISH // BATTLE PARAMETERS", "遭遇战 // 战斗参数"], ["SETTINGS // AUDIO & CONTROLS", "设置 // 音频与操控"], ["COMPLETION", "完成"], ["PERSONAL RESULT", "个人战绩"], ["SURVIVOR BOARD", "幸存者榜"], ["FRONTAL ARMOR", "正面装甲"], ["REAR ARMOR", "后部装甲"], ["SIDE ARMOR", "侧面装甲"], ["ROOF ARMOR", "顶部装甲"], ["BELLY ARMOR", "底部装甲"], ["TURRET SIDE", "炮塔侧面"], ["TURRET REAR", "炮塔后部"], ["TURRET ROOF", "炮塔顶部"], ["TURRET FRONT", "炮塔正面"], ["CAST DOME", "铸造穹顶"], ["UPPER GLACIS", "首上装甲"], ["LOWER GLACIS", "首下装甲"], ["HULL COMPOSITE", "车体复合装甲"], ["TURRET WEDGE", "炮塔楔形装甲"], ["TURRET RING", "炮塔座圈"], ["MANTLET", "炮盾"], ["rifled gun", "线膛炮"], ["smoothbore gun", "滑膛炮"], ["RHA steel", "均质钢装甲"], ["High-hardness RHA", "高硬度均质钢"], ["Cast RHA", "铸造均质钢"], ["Glacis", "首上"], ["Autoloader", "自动装弹机"], ["Semi-auto loader", "半自动装弹机"], ["supercharged diesel", "增压柴油机"], ["turbo diesel", "涡轮增压柴油机"], ["Turbo diesel", "涡轮增压柴油机"], ["diesel", "柴油机"], ["guided rockets", "制导火箭弹"], ["unguided rockets", "非制导火箭弹"], ["guided rocket", "制导火箭弹"], ["unguided rocket", "非制导火箭弹"], ["Missiles", "导弹"], ["missiles", "导弹"], ["Armored plate + self-seal tank", "装甲板 + 自封油箱"], ["Cockpit vs 12.7mm AP", "座舱防 12.7mm 穿甲弹"], ["Twin turboshaft", "双涡轴发动机"], ["rocket salvo", "火箭弹齐射"], ["multiple rocket launcher", "多管火箭炮"], ["Light frag cab", "轻型防破片驾驶室"], ["High-mobility chassis", "高机动底盘"], ["Twin 25mm autocannon", "双联 25mm 机炮"], ["twin cannon", "双联机炮"], ["Light welded hull", "轻型焊接车体"], ["Composite armor", "复合装甲"], ["Gas turbine engine", "燃气轮机"], ["Armored cockpit", "装甲座舱"], ["Vs 23mm", "防 23mm"], ["Armored cab", "装甲驾驶室"], ["tactical chassis", "战术底盘"], ["chassis", "底盘"], ["Light armored 4x4", "轻型装甲 4x4"], ["V8 diesel", "V8 柴油机"], ["chain gun", "链式机炮"], ["SOLID", "实心"], ["KEY MODULE", "关键模块"], ["CREW COMPARTMENT", "乘员舱"], ["TAC CORE MODULE", "战术核心模块"], ["ONE-SHOT KILL", "一击毁伤"], ["BLOWOUT PANEL", "泄压板"], ["SELF-SEAL TANK", "自封油箱"], ["PHYS THICKNESS", "物理厚度"], ["SLOPE ANGLE", "倾角"], ["LOS EQUIV", "等效厚度"], ["MATERIAL", "材质"], ["RHA STEEL", "均质钢装甲"], ["HEAVY COMPOSITE + FY-4 ERA", "重型复合装甲 + FY-4 反应装甲"], ["KEVLAR/CERAMIC LIGHT", "凯夫拉/陶瓷轻型装甲"], ["ARMORED PLATE + COMPOSITE COCKPIT", "装甲板 + 复合装甲座舱"], ["ARMORED CAB + SPALL LINER", "装甲驾驶室 + 防崩落衬层"], ["HIGH-STRENGTH SPALL PLATE", "高强度防崩落板"], ["HMMWV LIGHT PLATE", "悍马轻型装甲板"], ["LIGHT WELDED + BULLETPROOF GLASS", "轻型焊接装甲 + 防弹玻璃"], ["Spend experience to unlock and install", "消耗经验解锁并安装"], ["Click to remove installation", "点击卸下"], ["Click to install", "点击安装"], ["THERMAL IMAGING / EO-IR FCR", "热成像 / 光电火控雷达"], ["UNLOCK FAILED", "解锁失败"], ["UNLOCK", "解锁"], ["INSTALLED", "已安装"], ["INSTALL", "安装"], ["FIRE CONTROL COMPUTER", "火控计算机"], ["FCS COMPUTER", "火控计算机"], ["Computer fire control: 0.5s solution hold instead of manual table.", "计算机火控：以 0.5 秒解算保持替代手动射表。"], ["AUXILIARY LOADER", "辅助装填手"], ["AUX LOADER", "辅助装填"], ["Player reload time −0.5s.", "玩家装填时间 −0.5 秒。"], ["NON-SKID TRACK", "防滑履带"], ["Player ground rolling resistance coefficients ×0.70.", "玩家地面滚动阻力系数 ×0.70。"], ["IMPROVED 105MM GUN", "改进型 105mm 火炮"], ["IMPROVED 105MM", "改进 105mm"], ["Initial penetration 70% of RED-MBT-2 (currently 763mm), muzzle velocity 1600m/s, dispersion radius 2× RED-MBT-2.", "初始穿深为 99式 的 70%（当前 763mm），初速 1600米/秒，散布半径为 99式 的 2 倍。"], ["IMPROVED ENGINE", "改进型发动机"], ["Player maximum speed +10 km/h.", "玩家最高速度 +10 公里/小时。"], ["IMPROVED TURRET MOTOR", "改进型炮塔电机"], ["TURRET MOTOR", "炮塔电机"], ["Player turret rotation speed set to 20 deg/s.", "玩家炮塔旋转速度设为 20 度/秒。"], ["IMPROVED OPTICS", "改进型光学设备"], ["THERMAL OPTICS", "热成像光学"], ["Unlocks the player RED-MBT-1 thermal imaging function.", "解锁玩家 59式 的热成像功能。"], ["Unlocks the player BLUE-MBT-1 thermal imaging function.", "解锁玩家 M60 的热成像功能。"], ["Unlocks the player RED-TD thermal imaging function.", "解锁玩家 PTZ-89 的热成像功能。"], ["Unlocks the player RED-MLRS thermal imaging function.", "解锁玩家 PHL-11 的热成像功能。"], ["Unlocks the player BLUE-MLRS thermal imaging function.", "解锁玩家 M124 的热成像功能。"], ["Unlocks the player RED-AA thermal imaging function in the gun sight and normal view.", "解锁玩家 PGZ-95 在瞄准镜和常规视角下的热成像功能。"], ["Unlocks the player BLUE-AA thermal imaging function in the gun sight and normal view.", "解锁玩家蓝方防空车在瞄准镜和常规视角下的热成像功能。"], ["Player-only EO/IR gun-launched missile: 60 damage, 500mm penetration, seeker-only guidance. Keys 1 and 2 select the next loading cycle; a round already loaded keeps its weapon.", "玩家专属光电/红外炮射导弹：伤害 60，穿深 500mm，仅导引头制导。按 1 / 2 选择下一轮装填弹种；已装填的弹药保持不变。"], ["Initial penetration is 70% of BLUE-MBT-2 (359.8mm); because that is below the 446mm base, it is raised to 447mm. Muzzle velocity 1600m/s.", "初始穿深为 M1A1 的 70%（359.8mm），因低于 446mm 基准，提升至 447mm。初速 1600米/秒。"], ["Player BLUE-MBT-1 only: add 100mm to the initial penetration of AP rounds.", "仅限玩家 M60：穿甲弹初始穿深 +100mm。"], ["BATTLEFIELD REPAIR", "战场维修"], ["BATTLE REPAIR", "战场维修"], ["After taking damage, stop for 5s to prepare repairs, then restore one damaged module at 5 HP/s. Lowest relative HP first; each module is capped at 50% of maximum HP. Moving or taking new damage resets the repair condition.", "受损后停车 5 秒准备维修，随后以 5 耐久/秒修复一个受损模块。优先修复相对耐久最低的模块；每个模块最多恢复至最大耐久的 50%。移动或再次受损会重置维修条件。"], ["Player BLUE-MBT-2 only: add 100mm to the real equivalent armor of the upper and lower frontal hull. Turret, sides, rear, and AI BLUE-MBT-2 are unchanged.", "仅限玩家 M1A1：车体首上与首下装甲的实际等效厚度 +100mm。炮塔、侧面、后部及 AI 控制的 M1A1 不变。"], ["BURST LOADING", "连发装填"], ["Player BLUE-MBT-2 only: add 100mm to the initial penetration of every AP round. This is ammunition penetration, not armor.", "仅限玩家 M1A1：所有穿甲弹初始穿深 +100mm。此项提升弹药穿深，而非装甲。"], ["HIGH-EXPLOSIVE", "高爆弹"], ["Adds weapon 2: 180 damage, rocket-code blast radius, 1400m/s muzzle velocity, and fixed 500mm penetration. Weapon 1 remains AP.", "新增 2 号武器：伤害 180，爆炸半径同火箭弹，初速 1400米/秒，固定穿深 500mm。1 号武器仍为穿甲弹。"], ["IMPROVED COOLING SYSTEM", "改进型冷却系统"], ["LASER COOLING", "激光冷却"], ["Halves the player laser suppression cooldown from 30s to 15s.", "玩家激光压制冷却时间减半，由 30 秒降至 15 秒。"], ["IMPROVED POWER PACK", "改进型动力包"], ["POWER PACK", "动力包"], ["HIGH-POWER LASER", "大功率激光"], ["Reduces player laser emission to 2s; a vehicle hit by the beam cannot aim while it remains illuminated.", "玩家激光照射时间缩短至 2 秒；被照射的载具在持续受照期间无法瞄准。"], ["HEAVY ROCKET WARHEAD", "重型火箭弹战斗部"], ["ROCKET WARHEAD", "火箭弹战斗部"], ["HEAVY WARHEAD", "重型战斗部"], ["Player RED-HELI rocket damage increases from 40 to 60.", "玩家 WZ-10 火箭弹伤害由 40 提升至 60。"], ["Player RED-HELI guided rockets detonate 0.5m before a tracked enemy instead of waiting for a direct contact.", "玩家 WZ-10 的制导火箭弹会在距被跟踪敌人 0.5 米处提前起爆，无需直接命中。"], ["Player BLUE-HELI rocket damage increases to 120 per rocket.", "玩家 AH-64D 每枚火箭弹伤害提升至 120。"], ["AUTOMATIC CANNON", "自动机炮"], ["AUTO CANNON", "自动机炮"], ["Automatically aims at and fires the cannon at the nearest unobscured enemy within 1000m.", "自动瞄准并以机炮射击 1000 米内最近的无遮挡敌人。"], ["Player BLUE-HELI cannon initial penetration increases by 50mm, from 35mm to 85mm.", "玩家 AH-64D 机炮初始穿深提升 50mm，由 35mm 增至 85mm。"], ["GUIDED WARHEAD", "制导战斗部"], ["During the descending segment, player RED-MLRS rockets can home on hostile vehicles inside the fire-coverage circle; they retarget within the circle and otherwise keep normal bombardment.", "下降段中，玩家 PHL-11 的火箭弹可自动寻的火力覆盖圈内的敌方载具；在圈内重新选择目标，无目标时保持常规轰击。"], ["During the descending segment, player BLUE-MLRS rockets can home on hostile vehicles inside the fire-coverage circle; they retarget within the circle and otherwise keep normal bombardment.", "下降段中，玩家 M124 的火箭弹可自动寻的火力覆盖圈内的敌方载具；在圈内重新选择目标，无目标时保持常规轰击。"], ["ANTI-TANK MISSILE", "反坦克导弹"], ["Player-only selectable SAM / ATGM loadout: 180 damage, 800mm penetration, low-drag EO/IR ground guidance, effective range about 5km. AI RED-AA keeps the default SAM.", "玩家专属可选地空导弹 / 反坦克导弹挂载：伤害 180，穿深 800mm，低阻光电/红外对地制导，有效射程约 5 公里。AI 控制的 PGZ-95 仍使用默认地空导弹。"], ["Player-only selectable SAM / ATGM loadout matching RED-AA: 180 damage, 800mm penetration, low-drag EO/IR ground guidance, effective range about 5km. AI BLUE-AA keeps the default SAM.", "玩家专属可选地空导弹 / 反坦克导弹挂载（与 PGZ-95 相同）：伤害 180，穿深 800mm，低阻光电/红外对地制导，有效射程约 5 公里。AI 控制的蓝方防空车仍使用默认地空导弹。"], ["MANUAL TABLE", "手动射表"], ["BLAST", "爆炸"], ["DISP", "散布"], ["REL", "装填"], ["INITIAL PEN", "初始穿深"], ["EFFECTIVE", "有效"], ["EO/IR SEEKER", "光电/红外导引头"], ["ROCKET BLAST", "火箭弹爆炸"], ["SPEED EFFECT", "速度效果"], ["PROXIMITY", "近炸"], ["PER ROCKET", "每枚火箭弹"], ["AUTO AIM / FIRE WITHIN", "自动瞄准 / 射击范围"], ["COVERAGE HOMING", "覆盖区寻的"], ["TWIN 25MM AUTOCANNON", "双联 25mm 机炮"], ["SELECTABLE SAM OR ATGM", "可选地空导弹或反坦克导弹"], ["GROUND GUIDANCE", "对地制导"], ["EO/IR", "光电/红外"], ["ROCKET (GUIDED)", "火箭弹（制导）"], ["ROCKET (UNGUIDED)", "火箭弹（非制导）"], ["BLAST R", "爆炸半径"], ["RKT IMPACT", "火箭弹命中"], ["LASER SUPPRESSED", "激光压制中"], ["SUPPRESSED", "被压制"], ["TOF", "飞行时间"], ["IMMOBILIZED", "失去机动"], ["IMMOBILE", "无法移动"], ["DEGRADED", "性能下降"], ["RICOCHET", "跳弹"], ["EXTREME", "极高"], ["POWERPLANT", "动力装置"], ["AIRFRAME", "机体"], ["TURNTABLE", "转台"], ["WINGMEN", "僚机"], ["BORROWED", "借用"], ["RESTORED", "已恢复"], ["BURN", "燃烧"], ["CRASH", "坠毁"], ["FULL", "满"], ["LAID", "已布设"], ["LAYING", "布设中"], ["Achievements", "成就"], ["Collapse", "收起"], ["Expand", "展开"], ["Close", "关闭"], ["RESET ALL", "全部重置"], ["Bail out", "弃车"], ["RESERVE VEHICLES", "预备载具"], ["RADAR WARMING UP", "雷达预热中"], ["Turbo diesel off-road chassis", "涡轮增压柴油越野底盘"], ["Escape", "Esc"], ["MAIN GUN LOADING", "主炮装填中"], ["WEAPON", "武器"], ["LAUNCHER DAMAGED", "发射架受损"], ["MISSILE RACK DAMAGED", "导弹架受损"], ["AMMO RACK DAMAGED", "弹药架受损"], ["vehicle level tree", "载具等级树"], ["Player BLUE-MBT-2 only: permanent super reload (reload speed ×2). After each shot, fatigue can disable the effect for a random 10–20s; chance = (1 - turretHpPercent / 2) / 2, where turretHpPercent = current turret HP / turret max HP (0.25 full, 0.375 at 50%, 0.5 at 0%). Fatigue restores normal reload speed.", "仅限玩家 M1A1：永久超级装填（装填速度 ×2）。每次射击后，疲劳可能使该效果失效 10–20 秒（随机）；概率 = (1 − 炮塔耐久比 / 2) / 2，其中炮塔耐久比 = 当前炮塔耐久 / 炮塔最大耐久（满耐久时 0.25，50% 时 0.375，0% 时 0.5）。疲劳期间恢复正常装填速度。"]];

  var WORDS = {
    'FORCES':'兵力', 'ACTIVE':'生效', 'KILLS':'击杀', 'REDEPLOYS':'重部署', 'SURVIVORS':'幸存者',
    'PLAYER':'玩家', 'ENEMY':'敌方', 'OUR':'我方', 'FRIENDLY':'友方', 'FOE':'敌方', 'RESERVE':'预备', 'RESERVES':'预备兵力',
    'VEHICLE':'载具', 'VEHICLES':'载具', 'VEH':'载具', 'CREW':'乘员', 'CREWS':'乘员', 'FORCE':'兵力',
    'RED':'红方', 'BLUE':'蓝方', 'RED OOB':'红方编制', 'BLUE OOB':'蓝方编制',
    'READY':'就绪', 'PREPARING':'准备中', 'STARTING':'启动中', 'LOADING':'装填中', 'RELOADING':'重新装填中',
    'RELOAD':'装填', 'REDEPLOY':'重部署', 'DEPLOY':'部署', 'WAITING':'等待中', 'ONLINE':'在线', 'OFFLINE':'离线',
    'ON':'开', 'OFF':'关', 'LIVE':'在线', 'SYNC':'同步', 'GRANTED':'已授权', 'ARCHIVED':'已归档',
    'ACTIVE':'生效', 'STATUS':'状态', 'WARNING':'警告', 'ERROR':'错误', 'FAIL':'失败', 'FAILED':'失败',
    'FIRE':'开火', 'FIREPOWER':'火力', 'CANNON':'机炮', 'GUN':'火炮', 'MAIN':'主', 'TURRET':'炮塔',
    'MISSILE':'导弹', 'ROCKET':'火箭弹', 'ROCKETS':'火箭弹', 'CANNON':'机炮', 'SAM':'地空导弹', 'ATGM':'反坦克导弹',
    'AP':'穿甲', 'ROUND':'弹', 'HIGH-EXPLOSIVE':'高爆弹', 'HE':'高爆弹', 'ARMOR':'装甲', 'ARMOUR':'装甲',
    'PROTECTION':'防护', 'ENGINE':'发动机', 'FUEL':'燃料', 'AMMO':'弹药', 'TRACK':'履带', 'WHEELS':'车轮',
    'TRANSMISSION':'传动', 'MOBILITY':'机动', 'POWER':'动力', 'PWR':'动力', 'SPEED':'速度', 'RANGE':'距离',
    'TARGET':'目标', 'TARGETS':'目标', 'TGT':'目标', 'LOCK':'锁定', 'LOCKED':'已锁定', 'LOCKING':'锁定中',
    'TRACKING':'跟踪中', 'TRACKED':'被跟踪', 'WARNING':'警告', 'INCOMING':'来袭', 'IMPACT':'命中', 'HIT':'命中',
    'CAPTURE':'占领', 'CAPTURING':'占领中', 'CONTESTED':'争夺中', 'OPEN':'开放', 'ZONE':'区域', 'SECTOR':'扇区',
    'BOUNDARY':'边界', 'RETURN':'返回', 'NOW':'现在', 'LEFT':'左', 'RIGHT':'右', 'TOP':'上', 'BOTTOM':'下',
    'CENTER':'中央', 'BASE':'基地', 'STAGING':'集结', 'MAP':'地图', 'GRID':'网格', 'SIZE':'大小', 'POSITION':'位置',
    'SMALL':'小', 'MEDIUM':'中', 'LARGE':'大', 'DEFAULT':'默认', 'OFF':'关', 'HIGH':'高', 'LOW':'低', 'MED':'中',
    'VOLUME':'音量', 'MUSIC':'音乐', 'FILTER':'滤镜', 'COLOR':'色彩', 'GRADE':'分级', 'GRAPHICS':'画面',
    'QUALITY':'质量', 'MODEL':'模型', 'EXPLOSION':'爆炸', 'TOUCH':'触控', 'LAYOUT':'布局', 'RESET':'重置', 'SAVE':'保存',
    'VIEW':'视角', 'ROTATE':'旋转', 'INSPECT':'检视', 'MENU':'菜单', 'SIGHT':'瞄准镜', 'BAIL':'弃车', 'FOLLOW':'跟随',
    'COMMAND':'指挥', 'CMD':'指挥', 'VISION':'视觉', 'THERMAL':'热成像', 'FLIR':'热成像', 'LASER':'激光',
    'SUPPRESS':'压制', 'DECOY':'诱饵', 'FLARES':'诱饵弹', 'RADAR':'雷达', 'SEARCH':'搜索', 'AIR':'空中', 'GROUND':'地面',
    'HELICOPTER':'直升机', 'HELI':'直升机', 'ATTACK':'攻击', 'MULTIPLE':'多管', 'LAUNCH':'发射', 'ARTILLERY':'炮兵',
    'DEFENSE':'防御', 'DESTROYER':'歼击车', 'TANK':'坦克', 'HEAVY':'重型', 'MEDIUM':'中型', 'LIGHT':'轻型',
    'FCS':'火控系统', 'OPTICS':'光学', 'FIRE CONTROL':'火控', 'COMBAT':'战斗', 'BATTLE':'战斗', 'TACTICAL':'战术',
    'SYSTEM':'系统', 'SETTINGS':'设置', 'GUIDE':'指南', 'KEYBOARD':'键盘', 'MOUSE':'鼠标', 'DRIVE':'驾驶', 'HEADING':'航向',
    'GAME':'游戏', 'MODE':'模式', 'FACTION':'阵营', 'TIME':'时间', 'ROUGHNESS':'崎岖度', 'STAGING':'集结',
    'HULL':'车体', 'TRAVERSE':'转向', 'CLICK':'点击', 'WHEEL':'滚轮', 'ZOOM':'缩放', 'RADAR':'雷达', 'SCAN':'扫描',
    'THERMAL':'热成像', 'PRECISION':'精确', 'AIM':'瞄准', 'FORMATION':'编队', 'TAC':'战术', 'MARKER':'标记', 'TOGGLE':'切换',
    'DATA':'数据', 'DATABASE':'数据库', 'ARCHIVE':'档案', 'RECORD':'记录', 'RECORDS':'记录', 'ACHIEVEMENT':'成就',
    'LEVEL':'等级', 'EXPERIENCE':'经验', 'TECH':'技术', 'PENDING':'待定', 'PROTOCOL':'协议', 'SCHEMA':'架构',
    'PERSONNEL':'人员', 'SORTIES':'出击', 'DESTROYED':'摧毁', 'CURRENT':'当前', 'DEPLOYMENT':'部署', 'NO':'无', 'NONE':'无',
    'UNKNOWN':'未知', 'NOMINAL':'正常', 'N/A':'无', 'READY':'就绪', 'PAUSED':'暂停', 'RESUME':'继续', 'SUSPEND':'暂停',
    'SYSTEM':'系统', 'HALT':'暂停', 'REPAIR':'维修', 'REPAIRING':'维修中', 'REPAIRED':'已维修', 'DAMAGE':'损伤',
    'DAMAGED':'受损', 'MODULE':'模块', 'STOP':'停止', 'START':'开始', 'RETURNED':'已返回', 'ABANDONED':'已弃车',
    'TAKE':'夺取', 'TOOK':'已夺取', 'OBJECTIVE':'目标点', 'VICTORY':'胜利', 'DEFEAT':'失败', 'ELIMINATED':'已淘汰',
    'LAST':'最后', 'SURVIVOR':'幸存者', 'RANK':'排名', 'FINAL':'最终', 'TALLY':'统计', 'LOSS':'损失', 'LOSSES':'损失',
    'REMAINING':'剩余', 'KILLED':'击杀', 'KILL':'击杀', 'KILLS':'击杀', 'SQUAD':'小队', 'SEIZE':'夺取',
    'SHOOT':'射击', 'GUIDE':'引导', 'ABANDON':'弃车', 'RELEASED':'已释放', 'ACTIVATING':'激活中', 'ACQUIRING':'获取中',
    'CALIBRATING':'校准中', 'COMPILING':'编译中', 'PARSING':'解析中', 'INITIALIZING':'初始化中', 'WARMING':'预热中',
    'POWERING':'通电中', 'NOMINAL':'正常', 'RELOADED':'已装填', 'EMPTY':'空', 'SAFE':'安全', 'ESTABLISHED':'已建立',
    'DENSITY':'密度', 'SUPPORT':'支援', 'BOMBARDMENT':'轰击', 'TRANSPORT':'运输', 'REINFORCEMENTS':'增援', 'ARRIVED':'已抵达',
    'GUNNER':'炮手', 'COLLECTIVE':'总距', 'PITCH':'俯仰', 'ROLL':'横滚', 'YAW':'偏航', 'TRIM':'配平', 'UP':'上', 'DOWN':'下',
    'YOU':'你', 'PEN':'穿深', 'MV':'初速', 'DMG':'伤害', 'HP':'耐久', 'XP':'经验', 'KPH':'公里/小时',
    'KM/H':'公里/小时', 'KM':'公里', 'MM':'毫米', 'M/S':'米/秒', 'DEG/S':'度/秒',
    'DAY':'白天', 'DAWN':'黎明', 'DUSK':'黄昏', 'NIGHT':'夜晚', 'TIME':'时间', 'ROUGHNESS':'崎岖度', 'CONTROL':'控制',
    'HANGER':'机库', 'HANGAR':'机库', 'SECTOR':'扇区', 'LINK':'链路', 'NOISE':'噪声', 'REPORT':'报告', 'AUTH':'授权',
    'PWR':'动力', 'FPS':'帧率', 'SCANNING':'扫描中', 'STANDBY':'待机', 'WARMUP':'预热', 'READY':'就绪', 'NONE':'无'
  };

  function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function bounded(src) {
    var e = escapeRegExp(src);
    var pre = /^[A-Za-z]/.test(src) ? '(^|[^A-Za-z])' : '()';
    var post = /[A-Za-z]$/.test(src) ? '(?=$|[^A-Za-z])' : '';
    return new RegExp(pre + e + post, 'gi');
  }
  function compile(list) {
    return list.slice().sort(function (a, b) { return b[0].length - a[0].length; })
      .map(function (p) { return [bounded(p[0]), p[1]]; });
  }
  function normKey(k) {
    for (var i = 0; i < VEHICLE_RULES.length; i++) k = k.replace(VEHICLE_RULES[i][0], VEHICLE_RULES[i][1]);
    return unitRules(k);
  }
  function unitRules(t) {
    return t.replace(/(\d+(?:\.\d+)?)\s*m\/s\b/gi, '$1米/秒')
      .replace(/(\d+(?:\.\d+)?)\s*s\b/gi, '$1秒')
      .replace(/(\d+(?:\.\d+)?)\s*m\b/gi, '$1米');
  }
  /* PRE (校对修正) overrides PHRASES with the same key; all phrases compete longest-first. */
  var merged = {}, order = [];
  PHRASES.concat(PRE).forEach(function (p) {
    var k = normKey(p[0]), lk = k.toLowerCase();
    if (!(lk in merged)) order.push(lk);
    merged[lk] = [k, p[1]];
  });
  var PHRASE_RE = compile(order.map(function (lk) { return merged[lk]; }));
  var WORD_RE = Object.keys(WORDS).sort(function (a, b) { return b.length - a.length; }).map(function (k) {
    return [new RegExp('(^|[^A-Za-z0-9])' + escapeRegExp(k) + '(?=$|[^A-Za-z0-9])', 'gi'), WORDS[k]];
  });
  var EXACT = { 'NO': '否', 'YES': '是', 'LEFT': '左', 'RIGHT': '右' };
  var cache = Object.create(null), cacheSize = 0;
  function translateText(input) {
    if (input == null) return input;
    var text = String(input);
    if (!/[A-Za-z]/.test(text)) return text;
    if (text in cache) return cache[text];
    var orig = text, t = text.trim(), i;
    if (EXACT[t.toUpperCase()]) return text.replace(t, EXACT[t.toUpperCase()]);
    var bareVehicle = t.toLowerCase();
    if (bareVehicle === 'mbt2') return 'M1A1';
    if (bareVehicle === 'heli') return 'AH-64D';
    if (bareVehicle === 'mlrs') return 'M124';
    for (i = 0; i < VEHICLE_RULES.length; i++) text = text.replace(VEHICLE_RULES[i][0], VEHICLE_RULES[i][1]);
    text = unitRules(text);
    text = text.replace(/(\d+)\s+LEFT\b/gi, '剩余 $1');
    for (i = 0; i < PHRASE_RE.length; i++) text = text.replace(PHRASE_RE[i][0], '$1' + PHRASE_RE[i][1]);
    for (i = 0; i < WORD_RE.length; i++) text = text.replace(WORD_RE[i][0], '$1' + WORD_RE[i][1]);
    if (cacheSize < 20000) { cache[orig] = text; cacheSize++; }
    return text;
  }

  function translateAttrs(el) {
    if (!el || el.nodeType !== 1) return;
    ['title', 'aria-label', 'placeholder', 'value'].forEach(function (attr) {
      if (!el.hasAttribute(attr)) return;
      var old = el.getAttribute(attr), next = translateText(old);
      if (next !== old) el.setAttribute(attr, next);
    });
  }
  function translateNode(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      var next = translateText(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== 1 || node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
    translateAttrs(node);
    for (var c = node.firstChild; c; c = c.nextSibling) translateNode(c);
  }
  function translateAll() {
    if (!document.body) return;
    translateNode(document.body);
    document.title = translateText(document.title);
  }

  function wrapGlobal(name) {
    var fn = window[name];
    if (typeof fn !== 'function' || fn.__zhWrapped) return;
    var wrapped = function () {
      var args = Array.prototype.slice.call(arguments);
      if (args.length) args[0] = translateText(args[0]);
      return fn.apply(this, args);
    };
    wrapped.__zhWrapped = true;
    window[name] = wrapped;
  }
  function wrapOutput(name) {
    var fn = window[name];
    if (typeof fn !== 'function' || fn.__zhWrapped) return;
    var wrapped = function () { return translateText(fn.apply(this, arguments)); };
    wrapped.__zhWrapped = true;
    window[name] = wrapped;
  }

  function install() {
    translateAll();
    wrapGlobal('aimHint');
    wrapOutput('vehicleKindName');
    wrapOutput('vehicleDisplayName');
    if (typeof window.alert === 'function' && !window.alert.__zhWrapped) {
      var alertFn = window.alert;
      window.alert = function (msg) { return alertFn.call(this, translateText(msg)); };
      window.alert.__zhWrapped = true;
    }
    if (typeof window.confirm === 'function' && !window.confirm.__zhWrapped) {
      var confirmFn = window.confirm;
      window.confirm = function (msg) { return confirmFn.call(this, translateText(msg)); };
      window.confirm.__zhWrapped = true;
    }
    if (typeof MutationObserver !== 'undefined' && document.body && !document.body.__zhObserver) {
      var observer = new MutationObserver(function (records) {
        records.forEach(function (record) {
          if (record.type === 'characterData') translateNode(record.target);
          else if (record.type === 'attributes') translateAttrs(record.target);
          else for (var i = 0; i < record.addedNodes.length; i++) translateNode(record.addedNodes[i]);
        });
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder', 'value'] });
      document.body.__zhObserver = observer;
    }
    var style = document.createElement('style');
    style.textContent = ".sigmod #sigfps::after{content:' 帧率' !important;}";
    document.head.appendChild(style);
    if (window.CanvasRenderingContext2D && !window.CanvasRenderingContext2D.prototype.__zhWrapped) {
      var canvasProto = window.CanvasRenderingContext2D.prototype;
      var nativeFillText = canvasProto.fillText, nativeStrokeText = canvasProto.strokeText;
      canvasProto.fillText = function (text) {
        var args = Array.prototype.slice.call(arguments); args[0] = translateText(text);
        return nativeFillText.apply(this, args);
      };
      canvasProto.strokeText = function (text) {
        var args = Array.prototype.slice.call(arguments); args[0] = translateText(text);
        return nativeStrokeText.apply(this, args);
      };
      canvasProto.__zhWrapped = true;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
  window.ZH_LOCALIZE = translateText;
})();
