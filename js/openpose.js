import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";
import "./fabric.min.js";
function dataURLToBlob(dataurl) {
    var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], {type:mime});
}
const connect_keypoints = [
	[0, 1],   [1, 2],  [2, 3],   [3, 4],
	[1, 5],   [5, 6],  [6, 7],   [1, 8],
	[8, 9],   [9, 10], [1, 11],  [11, 12],
	[12, 13], [14, 0], [14, 16], [15, 0],
	[15, 17]
]

const connect_color = [
	[  0,   0, 255],
	[255,   0,   0],
	[255, 170,   0],
	[255, 255,   0],
	[255,  85,   0],
	[170, 255,   0],
	[ 85, 255,   0],
	[  0, 255,   0],

	[  0, 255,  85],
	[  0, 255, 170],
	[  0, 255, 255],
	[  0, 170, 255],
	[  0,  85, 255],
	[ 85,   0, 255],

	[170,   0, 255],
	[255,   0, 255],
	[255,   0, 170],
	[255,   0,  85]
]

const DEFAULT_KEYPOINTS = [
  [241,  77], [241, 120], [191, 118], [177, 183],
  [163, 252], [298, 118], [317, 182], [332, 245],
  [225, 241], [213, 359], [215, 454], [270, 240],
  [282, 360], [286, 456], [232,  59], [253,  60],
  [225,  70], [260,  72]
]

async function readFileToText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
            resolve(reader.result);
        };
        reader.onerror = async () => {
            reject(reader.error);
        }
        reader.readAsText(file);
    })
}

async function loadImageAsync(imageURL) {
    return new Promise((resolve) => {
        const e = new Image();
        e.setAttribute('crossorigin', 'anonymous');
        e.addEventListener("load", () => { resolve(e); });
        e.src = imageURL;
        return e;
    });
}

async function canvasToBlob(canvas) {
    return new Promise(function(resolve) {
        canvas.toBlob(resolve);
    });
}

class OpenPosePanel {
    node = null;
	canvas = null;
	canvasElem = null
	panel = null

	undo_history = []
	redo_history = []

	visibleEyes = true;
	flipped = false;
	lockMode = false;

    // 在 openpose.js 文件中，OpenPosePanel 类的任意位置（例如，在 lockMode = false; 下方）添加这个新函数

    inspectCanvasState() {
        console.log("--- [INSPECT] --- Canvas Object State ---");
        const allObjects = this.canvas.getObjects();
        console.log(`[INSPECT] Total objects on canvas: ${allObjects.length}`);

        const lines = this.canvas.getObjects('line');
        const circles = this.canvas.getObjects('circle');

        console.log(`[INSPECT] Found ${lines.length} lines and ${circles.length} circles.`);

        lines.forEach((line, index) => {
                const startPt = line._startCircle.getCenterPoint();
                const endPt = line._endCircle.getCenterPoint();
                console.log(
                        `[INSPECT] Line ${index}:`,
                        `Coords=(${line.x1.toFixed(2)}, ${line.y1.toFixed(2)}) -> (${line.x2.toFixed(2)}, ${line.y2.toFixed(2)})`,
                        `Linked Circles Pos: (${startPt.x.toFixed(2)}, ${startPt.y.toFixed(2)}) -> (${endPt.x.toFixed(2)}, ${endPt.y.toFixed(2)})`,
                        `Visible=${line.visible}`
                );
        });

        console.log("--- [INSPECT] --- End of Report ---");
    }


    // 【新增函数】
    deleteSelectedPoints() {
        const activeObjects = this.canvas.getActiveObjects();
        if (!activeObjects || activeObjects.length === 0) return;

        const objectsToDelete = new Set();
        const allLines = this.canvas.getObjects('line');

        // 1. 找出所有选中的、且符合“端点”条件的节点
        activeObjects.forEach(obj => {
            if (obj.type !== 'circle') return;

            // 动态计算当前节点的连接数
            let connectionCount = 0;
            allLines.forEach(line => {
                if (line._poseId === obj._poseId && (line._startCircle === obj || line._endCircle === obj)) {
                    connectionCount++;
                }
            });

            // 如果是端点（连接数<=1），则加入待删除列表
            if (connectionCount <= 1) {
                objectsToDelete.add(obj);
            }
        });

        if (objectsToDelete.size === 0) return;

        // 2. 找出与这些待删除节点相连的线
        allLines.forEach(line => {
            if (objectsToDelete.has(line._startCircle) || objectsToDelete.has(line._endCircle)) {
                objectsToDelete.add(line);
            }
        });

        // 3. 从画布中一次性删除它们
        objectsToDelete.forEach(obj => this.canvas.remove(obj));

        this.canvas.discardActiveObject();
        this.canvas.renderAll();
    }

    // 【新增函数】
    removeFilteredPose() {
        const filterIndex = parseInt(this.poseFilterInput.value, 10);
        
        // 获取所有姿态的ID并排序，建立“视觉顺序”
        const allCircles = this.canvas.getObjects('circle');
        const poseIds = [...new Set(allCircles.map(c => c._poseId))];
        poseIds.sort((a, b) => a - b);

        const objectsToRemove = new Set();

        if (filterIndex === -1) {
            // -1 代表移除所有姿态
            this.canvas.getObjects().forEach(obj => objectsToRemove.add(obj));
            this.nextPoseId = 0; // 重置姿态ID计数器
        } else if (filterIndex >= 0 && filterIndex < poseIds.length) {
            // 移除指定索引的姿态
            const targetPoseId = poseIds[filterIndex];
            this.canvas.getObjects().forEach(obj => {
                if (obj._poseId === targetPoseId) {
                    objectsToRemove.add(obj);
                }
            });
        }

        if (objectsToRemove.size === 0) return;

        // 从画布中删除，并重置筛选器
        objectsToRemove.forEach(obj => this.canvas.remove(obj));
        this.poseFilterInput.value = "-1"; // 将筛选器UI重置为“全部”
        this.applyPoseFilter(-1); // 应用重置，让剩余姿态都可选
        this.canvas.renderAll();
    }

    // 在 OpenPosePanel 类中...

    // 【在这里添加新函数】
    applyPoseFilter(filterIndex) {
        if (this.lockMode) return;
        
        // 1. 获取所有姿态的ID并排序，建立“视觉顺序”
        const allCircles = this.canvas.getObjects('circle');
        const poseIds = [...new Set(allCircles.map(c => c._poseId))];
        poseIds.sort((a, b) => a - b);
        
        let targetPoseId = -1;
        if (filterIndex >= 0 && filterIndex < poseIds.length) {
            targetPoseId = poseIds[filterIndex];
        }
        
        // 2. 遍历所有对象，根据 filterIndex 设置可选状态
        this.canvas.getObjects().forEach(obj => {
            if (filterIndex === -1) {
                // -1 代表全部可选
                obj.set({
                    selectable: true,
                    evented: true
                });
            } else {
                // 否则，只有匹配 targetPoseId 的对象才可选
                if (obj._poseId === targetPoseId) {
                    obj.set({
                        selectable: true,
                        evented: true
                    });
                } else {
                    obj.set({
                        selectable: false,
                        evented: false
                    });
                }
            }
        });

        // 3. 应用更改并重绘画布
        this.canvas.discardActiveObject(); // 取消当前选择
        this.canvas.renderAll();
    }
    // 【新函数结束】


    selectAll() {
        // 清除之前的状态
        this.canvas.discardActiveObject();
        if (this.activeSelection) {
            this.activeSelection.forEach(obj => obj.set('stroke', obj.originalStroke));
        }

        const allCircles = this.canvas.getObjects('circle');
        if (allCircles.length > 0) {
            // 直接填充我们自己的 activeSelection 数组并高亮
            this.activeSelection = [...allCircles];
            this.activeSelection.forEach(obj => {
                obj.originalStroke = obj.stroke;
                obj.set('stroke', '#FFFF00');
            });
            this.canvas.renderAll();
        }
    }

    // 请用这个新版本完整替换您的 constructor 函数
    constructor(panel, node, initialData = {}) {
        this.panel = panel;
        this.node = node;
        this.nextPoseId = 0;

        // --- 【诊断】 ---
        // 在构造函数的最开始，打印出节点属性中存储的姿态数据
        console.log("【诊断】正在打开编辑器，读取到节点'savedPose'属性为:", this.node.properties.savedPose);
        // --- 【诊断结束】 ---

        this.panel.style.overflow = 'hidden';
        this.setPanelStyle();

        const rootHtml = `
                <canvas class="openpose-editor-canvas" />
                <div class="canvas-drag-overlay" />
                <input bind:this={fileInput} class="openpose-file-input" type="file" accept=".json" />
                <input class="openpose-bg-file-input" type="file" accept="image/jpeg,image/png,image/webp" /> 
        `;

        const container = this.panel.addHTML(rootHtml, "openpose-container");
        container.style.cssText = "overflow: hidden; width: 100%; height: 100%; margin: auto; display: flex; align-items: center; justify-content: center;";

        // 我们之前的环境修复，确保框选功能正常
        container.style.pointerEvents = 'none';

        this.canvasWidth = 512;
        this.canvasHeight = 512;
        this.canvasElem = container.querySelector(".openpose-editor-canvas");
        this.canvasElem.width = this.canvasWidth;
        this.canvasElem.height = this.canvasHeight;
        this.canvasElem.style.cssText = "margin: 0.25rem; border-radius: 0.25rem; border: 0.5px solid;";

        this.canvas = this.initCanvas(this.canvasElem);
        this.canvas.wrapperEl.style.pointerEvents = 'auto';

        this.fileInput = container.querySelector(".openpose-file-input");
        this.fileInput.style.display = "none";
        this.fileInput.addEventListener("change", this.onLoad.bind(this));

        this.panel.addButton("Add", () => {
            // 将我们的默认姿态(DEFAULT_KEYPOINTS)转换为新的标准扁平数组格式
            const default_pose_keypoints_2d = [];
            DEFAULT_KEYPOINTS.forEach(pt => {
                // pt 是 [x, y]，我们把它变成 [x, y, confidence]
                default_pose_keypoints_2d.push(pt[0], pt[1], 1.0); 
            });

            // 调用 addPose 并传入正确格式的数据
            this.addPose(default_pose_keypoints_2d); 
            this.saveToNode(); 
        });

        this.panel.addButton("Delete Point", () => { this.deleteSelectedPoints(); this.saveToNode(); });
        this.panel.addButton("Remove Pose", () => { this.removeFilteredPose(); this.saveToNode(); });
        this.panel.addButton("Reset", () => {
            this.resetCanvas();

            // 1. 将旧的 DEFAULT_KEYPOINTS 数组转换为 setPose 函数期望的正确格式
            const default_pose_keypoints_2d = [];
            DEFAULT_KEYPOINTS.forEach(pt => {
                // pt 是 [x, y]，我们把它变成 [x, y, confidence] 的扁平数组
                default_pose_keypoints_2d.push(pt[0], pt[1], 1.0);
            });
            // 将扁平数组包装在标准的 "people" 结构中
            const defaultPeople = [{ "pose_keypoints_2d": default_pose_keypoints_2d }];

            // 2. 调用 setPose 并传入正确格式的数据
            this.setPose(defaultPeople);

            this.saveToNode();
        });
        this.panel.addButton("Save", () => this.save());
        this.panel.addButton("Load", () => this.load());
        this.panel.addButton("Select All", () => {
            // 1. 像以前一样，获取所有可选的节点
            const selectableCircles = this.canvas.getObjects('circle').filter(obj => obj.selectable);
            
            if (selectableCircles.length > 0) {
                this.canvas.discardActiveObject();
                
                // 2. 像以前一样，创建原生的选择组
                const selection = new fabric.ActiveSelection(selectableCircles, {
                    canvas: this.canvas,
                });
                this.canvas.setActiveObject(selection);
                
                // 3. 【核心修复】手动触发 'selection:created' 事件
                // 这会强制执行我们为框选编写的修正逻辑，确保按钮和框选走完全一样的代码流程
                this.canvas.fire('selection:created', { target: selection });

                // 4. 最终渲染画布
                this.canvas.renderAll();
            }
        });
        this.bgFileInput = container.querySelector(".openpose-bg-file-input");
        this.bgFileInput.style.display = "none";
        this.bgFileInput.addEventListener("change", (e) => this.loadBackgroundImage(e));
        this.panel.addButton("Load BG", () => this.bgFileInput.click());

        const setupDimensionInput = (label, value, callback) => {
                const lbl = document.createElement("label");
                lbl.innerHTML = label;
                lbl.style.cssText = "font-family: Arial; padding: 0 0.5rem; color: #ccc;";
                const input = document.createElement("input");
                input.style.cssText = "background: #1c1c1c; color: #aaa; width: 60px;";
                input.type = "number";
                input.min = "64";
                input.max = "4096";
                input.step = "64";
                input.value = value;
                input.addEventListener("change", callback);
                this.panel.footer.appendChild(lbl);
                this.panel.footer.appendChild(input);
                return input;
        };

        this.widthInput = setupDimensionInput("Width", this.canvasWidth, () => {
                this.resizeCanvas(+this.widthInput.value, +this.heightInput.value);
                this.saveToNode();
        });
        this.heightInput = setupDimensionInput("Height", this.canvasHeight, () => {
                this.resizeCanvas(+this.widthInput.value, +this.heightInput.value);
                this.saveToNode();
        });

        const lbl = document.createElement("label");
        lbl.innerHTML = "Pose Filter";
        lbl.style.cssText = "font-family: Arial; padding: 0 0.5rem; color: #ccc;";
        
        this.poseFilterInput = document.createElement("input");
        this.poseFilterInput.style.cssText = "background: #1c1c1c; color: #aaa; width: 60px;";
        this.poseFilterInput.type = "number";
        this.poseFilterInput.min = "-1";
        this.poseFilterInput.step = "1";
        this.poseFilterInput.value = "-1";
        // 使用 'input' 事件以获得即时响应
        this.poseFilterInput.addEventListener("input", () => {
            const filterValue = parseInt(this.poseFilterInput.value, 10);
            this.applyPoseFilter(filterValue);
            this.node.setProperty("poseFilterIndex", filterValue);
        });
        
        this.panel.footer.appendChild(lbl);
        this.panel.footer.appendChild(this.poseFilterInput);

        // --- 【核心修复】强化加载逻辑 ---
        // 检查'savedPose'属性是否有有效内容（不仅仅是存在）
        setTimeout(() => {       
            const savedFilterIndex = this.node.properties.poseFilterIndex;
            if (savedFilterIndex !== undefined && savedFilterIndex !== null) {
                this.poseFilterInput.value = savedFilterIndex;
                // 立即应用一次筛选，以确保画布状态正确
                this.applyPoseFilter(savedFilterIndex);
            }   
            // 检查并自动加载已保存的背景图
            const bgImageFilename = this.node.properties.backgroundImage;
            if (bgImageFilename) {
                const imageUrl = `/view?filename=${bgImageFilename}&type=input&t=${Date.now()}`;
                fabric.Image.fromURL(imageUrl, (img) => {
                    img.set({
                        scaleX: this.canvas.width / img.width,
                        scaleY: this.canvas.height / img.height,
                        opacity: 0.6,
                        selectable: false,
                        evented: false,
                    });
                    this.canvas.setBackgroundImage(img, this.canvas.renderAll.bind(this.canvas));
                }, { crossOrigin: 'anonymous' });
            }
            // 检查'savedPose'属性是否有有效内容（不仅仅是存在）
            if (this.node.properties.savedPose && this.node.properties.savedPose.trim() !== "") {
                    console.log("【诊断】检测到已保存的姿态，延迟后尝试加载...");
                    const error = this.loadJSON(this.node.properties.savedPose);
                    console.log("--- [INSPECT AFTER LOAD] --- 检查加载后的对象状态 ---");
                    this.inspectCanvasState();
                    if (error) {
                            console.error("[OpenPose Editor] 加载已保存的姿态失败，将使用默认姿态:", error);
                            // 如果加载失败，也要确保画布被正确初始化
                            this.resizeCanvas(this.canvasWidth, this.canvasHeight);
                            this.setPose(DEFAULT_KEYPOINTS);
                    } else {
                            console.log("【诊断】姿态加载成功！");
                    }
            } else {
                    console.log("【诊断】未找到已保存的姿态，或内容为空，初始化默认姿态。");
                    this.resizeCanvas(this.canvasWidth, this.canvasHeight);

                    // 1. 将旧的 DEFAULT_KEYPOINTS 转换为新的 "people" 格式
                    const default_pose_keypoints_2d = [];
                    DEFAULT_KEYPOINTS.forEach(pt => {
                        default_pose_keypoints_2d.push(pt[0], pt[1], 1.0);
                    });
                    const defaultPeople = [{ "pose_keypoints_2d": default_pose_keypoints_2d }];
                    
                    // 2. 调用 setPose 并传入正确格式的数据
                    this.setPose(defaultPeople);
            }
        }, 0); 

        const keyHandler = this.onKeyDown.bind(this);
        document.addEventListener("keydown", this.onKeyDown.bind(this));
        this.panel.onClose = () => { document.removeEventListener("keydown", keyHandler); };
    }

    setPanelStyle(){
        this.panel.style.transform = `translate(-50%,-50%)`;
        this.panel.style.margin = `0px 0px`;
    }

	onKeyDown(e) {
		if (e.key === "z" && e.ctrlKey) {
			this.undo()
			e.preventDefault();
			e.stopImmediatePropagation();
		}
		else if (e.key === "y" && e.ctrlKey) {
			this.redo()
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	}


    // 【请用此版本完整替换旧的 addPose 函数】
    addPose(pose_keypoints_2d = []) {
        const poseId = this.nextPoseId;
        const circles = {};
        const lines = [];

        // 循环18次，检查每个标准关节点是否存在
        for (let i = 0; i < 18; i++) {
            const x = pose_keypoints_2d[i * 3];
            const y = pose_keypoints_2d[i * 3 + 1];
            const confidence = pose_keypoints_2d[i * 3 + 2];

            if (confidence === 0) {
                continue;
            }

            const circle = new fabric.Circle({
                    left: x, top: y, radius: 5,
                    fill: `rgb(${connect_color[i] ? connect_color[i].join(", ") : '255,255,255'})`,
                    stroke: `rgb(${connect_color[i] ? connect_color[i].join(", ") : '255,255,255'})`,
                    originX: 'center', originY: 'center',
                    hasControls: false, hasBorders: false,
                    _id: i,
                    _poseId: poseId
            });
            circles[i] = circle;
        }

        // 连接线条的逻辑
        connect_keypoints.forEach((pair, i) => {
            const startCircle = circles[pair[0]];
            const endCircle = circles[pair[1]];
            if (!startCircle || !endCircle) return;

            // 【核心修复】将线条的视觉属性（颜色、宽度等）加回来
            const line = new fabric.Line([0, 0, 0, 0], {
                    stroke: `rgba(${connect_color[pair[0]] ? connect_color[pair[0]].join(", ") : '255,255,255'}, 0.7)`,
                    strokeWidth: 10,
                    selectable: false,
                    evented: false,
                    originX: 'center',
                    originY: 'center',
                    _startCircle: startCircle,
                    _endCircle: endCircle,
                    _poseId: poseId
            });
            // 【修复结束】

            lines.push(line);
        });

        this.nextPoseId++;
        this.canvas.add(...lines, ...Object.values(circles));
        
        // 返回Promise的异步更新部分保持不变
        return new Promise(resolve => {
            setTimeout(() => {
                lines.forEach(line => {
                    if (line._startCircle && line._endCircle) {
                        const startPoint = line._startCircle.getCenterPoint();
                        const endPoint = line._endCircle.getCenterPoint();
                        line.set({ x1: startPoint.x, y1: startPoint.y, x2: endPoint.x, y2: endPoint.y });
                        line.setCoords();
                    }
                });
                this.canvas.requestRenderAll();
                resolve();
            }, 0);
        });
    }

    async setPose(people){ // 参数从 poses 变为 people
        this.canvas.clear();
        this.canvas.backgroundColor = "#000";
        this.nextPoseId = 0;

        // 直接遍历 people 数组，并将每个 person 的数据传给 addPose
        const posePromises = people.map(person => this.addPose(person.pose_keypoints_2d || []));

        await Promise.all(posePromises);

        this.canvas.getObjects().forEach(obj => obj.setCoords());
        this.canvas.renderAll();
        this.saveToNode();

    }

    calcResolution(width, height){
        const viewportWidth = window.innerWidth / 2.25;
        const viewportHeight = window.innerHeight * 0.75;
        const ratio = Math.min(viewportWidth / width, viewportHeight / height);
        return {width: width * ratio, height: height * ratio}
    }

    resizeCanvas(width, height){

        if(width != null && height != null){
            this.canvasWidth = width;
            this.canvasHeight = height;
            
            this.widthInput.value = `${width}`
            this.heightInput.value = `${height}`
            
            this.canvas.setWidth(width);
            this.canvas.setHeight(height);
        }
        
        const rectPanel = this.canvasElem.closest('.openpose-container').getBoundingClientRect();

        if(rectPanel.width == 0 && rectPanel.height == 0){ //force reflow on panel creation
            setTimeout(()=>{
                this.resizeCanvas();
            },100)
            return;
        }

        const rectPanelAspectRatio = rectPanel.width / rectPanel.height;
        const canvasAspectRatio = this.canvasWidth / this.canvasHeight;

        [this.canvasElem,this.canvasElem.nextElementSibling,this.canvasElem.parentElement].forEach(el => {

            if(rectPanel.width < this.canvasWidth || rectPanel.height < this.canvasHeight){
                let scale;
                if (rectPanelAspectRatio > canvasAspectRatio) {
                    // Container is wider than canvas
                    scale = rectPanel.height / this.canvasHeight;
                } else {
                    // Container is taller than canvas
                    scale = rectPanel.width / this.canvasWidth;
                }
    
                el.style.width = `${this.canvasWidth * scale}px`;
                el.style.height = `${this.canvasHeight * scale}px`;
            } else {
                el.style.width = `${this.canvasWidth}px`;
                el.style.height = `${this.canvasHeight}px`;
            }
            
        })
    }

    undo() {
        if (this.undo_history.length > 0) {
            this.lockMode = true;
            if (this.undo_history.length > 1)
                this.redo_history.push(this.undo_history.pop());
            const content = this.undo_history[this.undo_history.length - 1];
            this.canvas.loadFromJSON(content, () => {
                this.canvas.renderAll();
                this.lockMode = false;
            });
        }
    }

    redo() {
        if (this.redo_history.length > 0) {
            this.lockMode = true;
            const content = this.redo_history.pop();
            this.undo_history.push(content);
            this.canvas.loadFromJSON(content, () => {
                this.canvas.renderAll();
                this.lockMode = false;
            });
        }
    }

    // 【最终的、完整的 initCanvas 函数】
    initCanvas(elem) {
        const canvas = new fabric.Canvas(elem, {
                backgroundColor: '#000',
                preserveObjectStacking: true,
                selection: true 
        });

        // 单点移动时的线条更新函数（这个逻辑是正确的）
        const updateLines = (target) => {
            if (!target || target.type !== 'circle') return;
            const pCenter = target.getCenterPoint();
            canvas.getObjects('line').forEach(line => {
                if (line._startCircle === target) line.set({ 'x1': pCenter.x, 'y1': pCenter.y });
                else if (line._endCircle === target) line.set({ 'x2': pCenter.x, 'y2': pCenter.y });
            });
        };
        canvas.on('object:moving', (e) => updateLines(e.target));
        // --- 【在这里添加新代码】 ---
        // 核心修复：监听原生选择事件，并从中剔除被锁定的对象
        canvas.on('selection:created', (e) => {
            const selection = e.target;

            // 【核心修复】只在目标是“选择组”时才执行逻辑
            if (selection.type === 'activeSelection') {
                const selectableObjects = selection.getObjects().filter(obj => obj.selectable);

                if (selectableObjects.length < selection.size()) {
                    canvas.discardActiveObject(); 

                    if (selectableObjects.length > 1) {
                        const correctSelection = new fabric.ActiveSelection(selectableObjects, { canvas: canvas });
                        canvas.setActiveObject(correctSelection);
                    } else if (selectableObjects.length === 1) {
                        canvas.setActiveObject(selectableObjects[0]);
                    }
                }
            }
        });
        
        // 【核心修复】一个全新的、结合了所有成功经验的 object:modified 处理器
        canvas.on("object:modified", (e) => {
            if (this.lockMode || !e.target) return;
        
            // 【关键步骤】在序列化之前，我们先手动计算并修正所有可能出错的坐标
            // 这一步将彻底解决“多选后瞬移”的问题
            const target = e.target;
            if (target.type === 'activeSelection') {
                // "审计"开始：我们不信任Fabric.js的临时坐标
                const groupMatrix = target.calcTransformMatrix();
                target.forEachObject(obj => {
                    if (obj.type === 'circle') {
                        // 手动计算每个点在世界坐标系中的绝对位置
                        const point = new fabric.Point(obj.left, obj.top);
                        const finalPos = fabric.util.transformPoint(point, groupMatrix);
                        // 用我们自己算出的、100%可靠的坐标，来强制更新这个对象
                        obj.set({
                            left: finalPos.x,
                            top: finalPos.y
                        });
                        obj.setCoords();
                    }
                });
                // "审计"结束：现在画布上所有点的坐标都是最终且正确的了
            }
        
            // 现在，我们可以安全地调用我们那个能正确处理多姿态的 serializeJSON 函数了
            const currentStateJson = this.serializeJSON();
        
            // 使用这份100%正确的数据来执行“原地重载”
            this.undo_history.push(currentStateJson);
            this.redo_history.length = 0;
            this.loadJSON(currentStateJson);
            this.saveToNode();
        });

        return canvas;
    }

    saveToNode() {
        const newPoseJson = this.serializeJSON();
        console.log(`[DEBUG_FRONTEND] ${new Date().toLocaleTimeString()} - saveToNode() called.`);
        console.log("[DEBUG_FRONTEND] Current node properties:", this.node.properties.savedPose);
        console.log("[DEBUG_FRONTEND] New pose data to be saved:", newPoseJson);
        // --- 【调试代码结束】 ---
        this.node.setProperty("savedPose", this.serializeJSON());
        this.uploadAndSetImages();
    }

    // 【请用此版本替换旧的 captureCanvasClean 函数】
    async captureCanvasClean() {
        this.lockMode = true;
        
        // 【核心改动1】获取并临时隐藏背景图
        const backgroundImage = this.canvas.backgroundImage;
        if (backgroundImage) {
            backgroundImage.visible = false;
        }

        // 隐藏前景图片（如果有的话）
        this.canvas.getObjects("image").forEach((img) => {
                img.opacity = 0;
        });
        
        this.canvas.discardActiveObject();
        this.canvas.renderAll(); // 应用隐藏效果

        // 截取纯净的画布
        const dataURL = this.canvas.toDataURL({ 
                multiplier: 1,
                format: 'png'
        });
        const blob = dataURLToBlob(dataURL);

        // 【核心改动2】恢复背景图
        if (backgroundImage) {
            backgroundImage.visible = true;
        }

        // 恢复前景图片
        this.canvas.getObjects("image").forEach((img) => {
                img.opacity = 1;
        });
        this.canvas.renderAll(); // 应用恢复效果

        this.lockMode = false;
        return blob;
    }

    // 【请用此版本替换旧的 captureCanvasCombined 函数】
    async captureCanvasCombined() {
        this.lockMode = true;

        // 【核心改动1】在截图前，临时将背景图的透明度设置为100%
        const backgroundImage = this.canvas.backgroundImage;
        let originalOpacity = 1.0; // 默认为1
        if (backgroundImage) {
            originalOpacity = backgroundImage.opacity; // 保存原始透明度
            backgroundImage.opacity = 1.0; // 设置为完全不透明
        }

        this.canvas.discardActiveObject();
        this.canvas.renderAll(); // 应用透明度修改

        const dataURL = this.canvas.toDataURL({ 
                multiplier: 1,
                format: 'png'
        });
        const blob = dataURLToBlob(dataURL);
        
        // 【核心改动2】截图后，立刻将背景图的透明度恢复原样
        if (backgroundImage) {
            backgroundImage.opacity = originalOpacity;
        }
        this.canvas.renderAll(); // 恢复编辑器内的视觉效果

        this.lockMode = false;
        return blob;
    }


    async uploadAndSetImages() {
        try {
            // --- 第一步: 捕获并上传“纯姿态图” (第一个输出) ---
            const cleanBlob = await this.captureCanvasClean();
            // 检查画布是否为空，避免上传空图片
            if (!cleanBlob || cleanBlob.size === 0) {
                console.warn("OpenPose Editor: Canvas is empty, skipping upload.");
                return;
            }
            
            const cleanFilename = `ComfyUI_OpenPose_${this.node.id}.png`;
            
            const bodyClean = new FormData();
            bodyClean.append("image", cleanBlob, cleanFilename);
            bodyClean.append("overwrite", "true");

            const respClean = await fetch("/upload/image", { method: "POST", body: bodyClean });
            if (respClean.status !== 200) {
                throw new Error(`Failed to upload clean pose image: ${respClean.statusText}`);
            }
            const dataClean = await respClean.json();
            // 将纯姿态图设置为节点的主预览图和第一个输入
            await this.node.setImage(dataClean.name);

            // --- 第二步: 捕获并上传“带背景的合成图” (第二个输出) ---
            // 仅当存在背景图时才执行
            if (this.canvas.backgroundImage) {
                const combinedBlob = await this.captureCanvasCombined();
                const combinedFilename = `ComfyUI_OpenPose_${this.node.id}_combined.png`;

                const bodyCombined = new FormData();
                bodyCombined.append("image", combinedBlob, combinedFilename);
                bodyCombined.append("overwrite", "true");

                // 静默上传，不需要处理返回值，因为后端会根据第一个文件名推断它
                const respCombined = await fetch("/upload/image", { method: "POST", body: bodyCombined });
                if (respCombined.status !== 200) {
                    console.error(`Failed to upload combined image: ${respCombined.statusText}`);
                }
            }

        } catch (error) {
            console.error(error);
            alert(error);
        }
    }


    resetCanvas() {
        this.canvas.clear()
        this.canvas.backgroundColor = "#000"
        this.nextPoseId = 0;
    }

    load() {
        this.fileInput.value = null;
        this.fileInput.click();
    }

    async onLoad(e) {
        const file = this.fileInput.files[0];
        const text = await readFileToText(file);
        const error = await this.loadJSON(text);
        if (error != null) {
            app.ui.dialog.show(error);
        }
        else {
            this.saveToNode();
        }
    }

    // 【请用此版本替换旧的 serializeJSON 函数】
    serializeJSON() {
        const allCircles = this.canvas.getObjects('circle');
        const poses = {};
        allCircles.forEach(circle => {
            const poseId = circle._poseId;
            if (!poses[poseId]) {
                poses[poseId] = [];
            }
            poses[poseId].push(circle);
        });

        const people = [];
        Object.keys(poses).sort((a, b) => a - b).forEach(poseId => {
            const poseCircles = poses[poseId];
            
            // 创建一个长度为 18 * 3 = 54 的模板数组，用0填充
            const keypoints_2d = new Array(18 * 3).fill(0);

            // 将画布上存在的点填充到模板数组的正确位置
            poseCircles.forEach(circle => {
                const pointId = circle._id;
                const center = circle.getCenterPoint();
                keypoints_2d[pointId * 3] = center.x;
                keypoints_2d[pointId * 3 + 1] = center.y;
                keypoints_2d[pointId * 3 + 2] = 1.0; // 自定义点的置信度设为1.0
            });

            people.push({
                "pose_keypoints_2d": keypoints_2d
            });
        });

        const json = JSON.stringify({
                "width": this.canvas.width,
                "height": this.canvas.height,
                "people": people // 使用标准的 "people" 结构
        }, null, 4);

        return json;
    }

    // 【请用此版本替换旧的 loadBackgroundImage 函数】
    async loadBackgroundImage(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            // --- 新增逻辑：将背景图上传到服务器 ---
            const body = new FormData();
            body.append("image", file);
            body.append("overwrite", "true"); // 允许覆盖

            const resp = await fetch("/upload/image", { method: "POST", body: body });
            if (resp.status !== 200) {
                throw new Error(`Failed to upload background image: ${resp.statusText}`);
            }
            const data = await resp.json();
            const filename = data.name;
            
            // --- 新增逻辑：将文件名保存到节点属性中 ---
            this.node.setProperty("backgroundImage", filename);

            // --- 更新逻辑：从服务器URL加载图片，而不是本地DataURL ---
            const imageUrl = `/view?filename=${filename}&type=input&subfolder=${data.subfolder}&t=${Date.now()}`;
            fabric.Image.fromURL(imageUrl, (img) => {
                img.set({
                    scaleX: this.canvas.width / img.width,
                    scaleY: this.canvas.height / img.height,
                    opacity: 0.6,
                    selectable: false,
                    evented: false,
                });
                this.canvas.setBackgroundImage(img, this.canvas.renderAll.bind(this.canvas));

                // ================== 【 THE FIX 】 ==================
                // Immediately generate and upload the new combined image
                // so the backend can find it on the next run.
                this.uploadAndSetImages();
                // ====================================================

            }, { crossOrigin: 'anonymous' }); // 需要 crossOrigin 才能在Canvas中使用

        } catch (error) {
            console.error(error);
            alert(error);
        } finally {
            e.target.value = '';
        }
    }
    
    save() {
        const json = this.serializeJSON()
        const blob = new Blob([json], {
            type: "application/json"
        });
        const filename = "pose-" + Date.now().toString() + ".json"
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    // 【请用此版本替换旧的 loadJSON 函数】
    loadJSON(text) {
        try {
            const tempBackgroundImage = this.canvas.backgroundImage;
            const json = JSON.parse(text);

            if (!json["width"] || !json["height"]) {
                return 'JSON is missing width or height properties.';
            }
            this.resizeCanvas(json["width"], json["height"]);
            
            // 我们现在加载 "people" 数组，它可能不存在，所以给一个默认空数组
            const people = json["people"] || [];

            // --- “自动居中”逻辑，现在适配了新数据结构 ---
            let allKeypointsForCheck = [];
            people.forEach(person => {
                const keypoints_2d = person.pose_keypoints_2d || [];
                for (let i = 0; i < keypoints_2d.length; i += 3) {
                    // 只对存在的点 (confidence > 0) 进行边界检查
                    if (keypoints_2d[i + 2] > 0) {
                        allKeypointsForCheck.push([keypoints_2d[i], keypoints_2d[i + 1]]);
                    }
                }
            });

            if (allKeypointsForCheck.length > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                allKeypointsForCheck.forEach(pt => {
                    if (pt[0] < minX) minX = pt[0];
                    if (pt[0] > maxX) maxX = pt[0];
                    if (pt[1] < minY) minY = pt[1];
                    if (pt[1] > maxY) maxY = pt[1];
                });

                const canvasWidth = this.canvas.getWidth();
                const canvasHeight = this.canvas.getHeight();
                let offsetX = 0, offsetY = 0;

                if (maxX < 0 || minX > canvasWidth || maxY < 0 || minY > canvasHeight) {
                    const poseWidth = maxX - minX;
                    const poseHeight = maxY - minY;
                    offsetX = -minX + (canvasWidth - poseWidth) / 2;
                    offsetY = -minY + (canvasHeight - poseHeight) / 2;
                    
                    console.log("检测到画布外姿态，自动居中。");
                    // 将偏移量应用回原始的 people 数据结构
                    people.forEach(person => {
                        const keypoints_2d = person.pose_keypoints_2d || [];
                        for (let i = 0; i < keypoints_2d.length; i += 3) {
                            if (keypoints_2d[i + 2] > 0) { // 只移动存在的点
                                keypoints_2d[i] += offsetX;
                                keypoints_2d[i + 1] += offsetY;
                            }
                        }
                    });
                }
            }
            // --- “自动居中”逻辑结束 ---

            this.setPose(people);
            
            this.canvas.setBackgroundImage(tempBackgroundImage, this.canvas.renderAll.bind(this.canvas));
            
            // (撤回/重做和筛选器状态恢复的逻辑保持不变)

            if (this.poseFilterInput) {
                const currentFilterIndex = parseInt(this.poseFilterInput.value, 10);
                if (!isNaN(currentFilterIndex)) {
                    this.applyPoseFilter(currentFilterIndex);
                }
            }
            
            return null;
        } catch (e) {
            console.error("Failed to parse or load pose JSON:", e);
            return `Failed to parse JSON: ${e.message}`;
        }
    }

}

app.registerExtension({
    name: "Nui.OpenPoseEditor",
	async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "Nui.OpenPoseEditor") {
            return
        }

        fabric.Object.prototype.transparentCorners = false;
        fabric.Object.prototype.cornerColor = '#108ce6';
        fabric.Object.prototype.borderColor = '#108ce6';
        fabric.Object.prototype.cornerSize = 10;

        const makePanelDraggable = function(panelElement){
            let isDragging = false;
            let offsetX = 0;
            let offsetY = 0;
        
            const header = panelElement.querySelector(".dialog-header") || panelElement;
            header.style.userSelect = 'none';
            header.style.cursor = "move";
        
            header.addEventListener("mousedown", (e) => {
                isDragging = true;
                document.body.style.userSelect = "none";
            });
        
            window.addEventListener("mousemove", (e) => {
                if (isDragging) {
                    const rectPanel = panelElement.getBoundingClientRect();
                    console.log(rectPanel.left - e.movementX)
                    
                    if( rectPanel.left < document.querySelector('.side-tool-bar-container').offsetWidth && e.movementX < 0 ){
                        panelElement.style.left = `${rectPanel.width / 2}px)`;
                    } else if( rectPanel.left + rectPanel.width > window.innerWidth && e.movementX > 0 ){
                        panelElement.style.left = `${window.innerWidth - rectPanel.width}px)`;
                    } else {
                        offsetX -= e.movementX;
                        panelElement.style.left = `calc( 50% - ${offsetX}px)`;
                    }

                    if( rectPanel.top < document.querySelector('.comfyui-menu').offsetHeight && e.movementY < 0 ){
                        panelElement.style.top = `${rectPanel.height / 2}px)`;
                    } else if( rectPanel.top + rectPanel.height > window.innerHeight && e.movementY > 0 ){
                        panelElement.style.left = `${window.innerWidth - rectPanel.height}px)`;
                    } else {
                        offsetY -= e.movementY;
                        panelElement.style.top = `calc( 50% - ${offsetY}px)`;
                    }
                    
                }
            });
        
            window.addEventListener("mouseup", () => {
                isDragging = false;
                document.body.style.userSelect = "";
            });
        }

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

            if (!this.properties) {
                this.properties = {};
                this.properties.savedPose = "";
            }

            this.serialize_widgets = true;

            // Output & widget
            this.imageWidget = this.widgets.find(w => w.name === "image");
            this.imageWidget.callback = this.showImage.bind(this);
            this.imageWidget.disabled = true
            // console.error(this);

            // Non-serialized widgets
            this.jsonWidget = this.addWidget("text", "", this.properties.savedPose, "savedPose");
            this.jsonWidget.disabled = true
            this.jsonWidget.serialize = true

            this.openWidget = this.addWidget("button", "open editor", "image", () => {
                const graphCanvas = LiteGraph.LGraphCanvas.active_canvas
                if (graphCanvas == null)
                    return;

                const panel = graphCanvas.createPanel("OpenPose Editor", { closable: true });
                panel.node = this;
                panel.classList.add("openpose-editor");
                
                this.openPosePanel = new OpenPosePanel(panel, this);
                makePanelDraggable(panel,this.openPosePanel);
                document.body.appendChild(this.openPosePanel.panel);

                const resizer = document.createElement("div");
                resizer.style.width = "10px";
                resizer.style.height = "10px";
                resizer.style.background = "#888";
                resizer.style.position = "absolute";
                resizer.style.right = "0";
                resizer.style.bottom = "0";
                resizer.style.cursor = "se-resize";
                panel.appendChild(resizer);

                // Add to document
                document.body.appendChild(panel);

                // Handle resizing
                let isResizing = false;
                resizer.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    isResizing = true;
                });

                document.addEventListener("mousemove", (e) => {
                    if (!isResizing) return;
                    const rect = panel.getBoundingClientRect();
                    panel.style.width = `${e.clientX - rect.left}px`;
                    panel.style.height = `${e.clientY - rect.top}px`;
                });

                document.addEventListener("mouseup", () => {
                    isResizing = false;
                    this.openPosePanel.resizeCanvas()
                });
            });
            this.openWidget.serialize = false;

            // On load if we have a value then render the image
            // The value isnt set immediately so we need to wait a moment
            // No change callbacks seem to be fired on initial setting of the value
            requestAnimationFrame(async () => {
                if (this.imageWidget.value) {
                    await this.setImage(this.imageWidget.value);
                }
            });
        }

        nodeType.prototype.showImage = async function(name) {
            let folder_separator = name.lastIndexOf("/");
            let subfolder = "";
            if (folder_separator > -1) {
                subfolder = name.substring(0, folder_separator);
                name = name.substring(folder_separator + 1);
            }
            const img = await loadImageAsync(`/view?filename=${name}&type=input&subfolder=${subfolder}&t=${Date.now()}`);
            this.imgs = [img];
            // this.setSizeForImage();
            app.graph.setDirtyCanvas(true);
        }

        nodeType.prototype.setImage = async function(name) {
            this.imageWidget.value = name;
            await this.showImage(name);
        }

        // Update savedPose text field on value change
        const baseOnPropertyChanged = nodeType.prototype.onPropertyChanged;
        nodeType.prototype.onPropertyChanged = function (property, value, prev) {
            if (property === "savedPose" && this.jsonWidget) {
                this.jsonWidget.value = value;
            } else if (baseOnPropertyChanged) {
                baseOnPropertyChanged.call(this, property, value, prev);
            }
        };

    }
});
