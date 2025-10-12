import os.path
import folder_paths
from nodes import LoadImage
import json
import time
import numpy as np
import torch
import cv2
import math
from PIL import Image

# ====================================================================================================
# 【最终整合版】OpenPose Editor 节点
# ====================================================================================================
class OpenPoseEditor:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("STRING", { "default": "" }),
            },
            # 新增的可选参数，用于DWPose渲染
            "optional": {
                "output_width_for_dwpose": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "output_height_for_dwpose": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "scale_for_xinsr_for_dwpose": ("BOOLEAN", {"default": False}),
            },
            # 隐藏输入，用于从前端接收数据
            "hidden": {
                "savedPose": ("STRING", {"multiline": True}),
                "backgroundImage": ("STRING", {"multiline": False}), # 新增，用于接收背景图文件名
            }
        }
    
    @classmethod
    def IS_CHANGED(s, image, savedPose, backgroundImage, **kwargs):
        # 当任何关键数据变化时，都强制重新运行
        return f"{savedPose}-{backgroundImage}-{time.time()}"

    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE",)
    RETURN_NAMES = ("pose_image", "combined_image", "dw_pose_image", "dw_combined_image",)
    FUNCTION = "get_images"
    CATEGORY = "image"
    
    # 这是一个辅助函数，将渲染逻辑独立出来，保持主函数清晰
    def render_dw_pose(self, pose_json, width, height, scale_for_xinsr):
        if not pose_json or not pose_json.strip():
            return np.zeros((height, width, 3), dtype=np.uint8)
        try:
            data = json.loads(pose_json)
        except json.JSONDecodeError:
            return np.zeros((height, width, 3), dtype=np.uint8)

        target_w, target_h = width, height
        original_w, original_h = data.get('width', target_w), data.get('height', target_h)
        scale_x, scale_y = target_w / original_w, target_h / original_h

        canvas = np.zeros((target_h, target_w, 3), dtype=np.uint8)
        people = data.get('people', [])
        if not people:
            return canvas

        limbSeq = [[2, 3], [2, 6], [3, 4], [4, 5], [6, 7], [7, 8], [2, 9], [9, 10], [10, 11], [2, 12], [12, 13], [13, 14], [2, 1], [1, 15], [15, 17], [1, 16], [16, 18]]
        colors = [[255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85]]
        
        BASE_RESOLUTION_SIDE = 512.0
        base_thickness = 2.0
        target_max_side = max(target_w, target_h)
        scale_factor = target_max_side / BASE_RESOLUTION_SIDE
        scaled_joint_radius = int(max(1, base_thickness * scale_factor))
        scaled_stickwidth = scaled_joint_radius

        if scale_for_xinsr:
            xinsr_stick_scale = 1 if target_max_side < 500 else min(2 + (target_max_side // 1000), 7)
            scaled_stickwidth *= xinsr_stick_scale

        for person in people:
            keypoints_flat = person.get('pose_keypoints_2d', [])
            keypoints = [ (int(keypoints_flat[i] * scale_x), int(keypoints_flat[i+1] * scale_y)) if keypoints_flat[i+2] > 0 else None for i in range(0, len(keypoints_flat), 3) ]
            
            for limb_indices, color in zip(limbSeq, colors):
                k1_idx, k2_idx = limb_indices[0] - 1, limb_indices[1] - 1
                if k1_idx >= len(keypoints) or k2_idx >= len(keypoints): continue
                p1, p2 = keypoints[k1_idx], keypoints[k2_idx]
                if p1 is None or p2 is None: continue
                
                Y, X = np.array([p1[0], p2[0]]), np.array([p1[1], p2[1]])
                mX, mY = np.mean(X), np.mean(Y)
                length = np.sqrt((X[0] - X[1])**2 + (Y[0] - Y[1])**2)
                angle = math.degrees(math.atan2(X[0] - X[1], Y[0] - Y[1]))
                
                polygon = cv2.ellipse2Poly((int(mY), int(mX)), (int(length / 2), scaled_stickwidth), int(angle), 0, 360, 1)
                cv2.fillConvexPoly(canvas, polygon, [int(c * 0.6) for c in color])

            for i, keypoint in enumerate(keypoints):
                if keypoint is None: continue
                if i >= len(colors): continue
                cv2.circle(canvas, keypoint, scaled_joint_radius, colors[i], thickness=-1)
        
        return cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB) # 返回RGB格式的NumPy数组

# 【请用这个修正过的版本，替换您文件中的 get_images 函数】
    def get_images(self, image, savedPose, backgroundImage, output_width_for_dwpose, output_height_for_dwpose, scale_for_xinsr_for_dwpose):
        # --- 输出 1 & 2: 原有的 Fabric.js 风格预览图 ---
        pose_image_fabric, _ = LoadImage.load_image(self, image)
        
        base_name, ext = os.path.splitext(image)
        combined_image_name = f"{base_name}_combined{ext}"
        combined_image_path = folder_paths.get_annotated_filepath(combined_image_name)
        
        if not os.path.exists(combined_image_path):
            combined_image_fabric = pose_image_fabric
        else:
            combined_image_fabric, _ = LoadImage.load_image(self, combined_image_name)
        
        # --- 输出 3: 纯 DW Pose 渲染图 ---
        # 【修改点】在这里使用新的变量名
        dw_pose_np = self.render_dw_pose(savedPose, output_width_for_dwpose, output_height_for_dwpose, scale_for_xinsr_for_dwpose)
        dw_pose_image = torch.from_numpy(dw_pose_np.astype(np.float32) / 255.0).unsqueeze(0)

        # --- 输出 4: DW Pose 与背景的合成图 ---
        if backgroundImage and backgroundImage.strip() != "":
            # 1. 加载背景图
            bg_image_path = folder_paths.get_annotated_filepath(backgroundImage)
            if os.path.exists(bg_image_path):
                bg_image_pil = Image.open(bg_image_path)
                bg_image_np = np.array(bg_image_pil.convert("RGB"))
                
                # 2. 缩放背景图到目标尺寸
                # 【修改点】在这里使用新的变量名
                bg_image_resized = cv2.resize(bg_image_np, (output_width_for_dwpose, output_height_for_dwpose), interpolation=cv2.INTER_AREA)

                # 3. 创建蒙版并进行合成
                dw_pose_gray = cv2.cvtColor(dw_pose_np, cv2.COLOR_RGB2GRAY)
                _, mask = cv2.threshold(dw_pose_gray, 1, 255, cv2.THRESH_BINARY)
                
                # 4. 使用蒙版将骨骼“粘贴”到背景上
                dw_combined_np = bg_image_resized.copy()
                dw_combined_np[mask != 0] = dw_pose_np[mask != 0]

                dw_combined_image = torch.from_numpy(dw_combined_np.astype(np.float32) / 255.0).unsqueeze(0)
            else:
                 # 如果背景文件找不到，就返回纯姿态图
                dw_combined_image = dw_pose_image
        else:
            # 如果没有背景，则合成图就是纯姿态图
            dw_combined_image = dw_pose_image
            
        return (pose_image_fabric, combined_image_fabric, dw_pose_image, dw_combined_image)

# ====================================================================================================
# 原有的 SavePoseToJson 节点 (可选，可以保留也可以删除)
# ====================================================================================================
class SavePoseToJson:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",), 
                "pose_keypoint": ("POSE_KEYPOINT",),
                "filename_prefix": ("STRING", {"default": "poses/pose"})
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("filename",)
    FUNCTION = "save_json"
    OUTPUT_NODE = True
    CATEGORY = "image"

    def save_json(self, pose_keypoint, image, filename_prefix="pose"):
        # 1. 从 image 张量中自动获取宽度和高度
        image_height, image_width = image.shape[1:3]
        
        # 2. 从复杂的 POSE_KEYPOINT 数据中提取出纯净的 "people" 列表
        processed_people = []
        if pose_keypoint and isinstance(pose_keypoint, list) and len(pose_keypoint) > 0:
            for result_dict in pose_keypoint:
                people_in_dict = result_dict.get("people", [])
                for person in people_in_dict:
                    original_keypoints = person.get("pose_keypoints_2d", [])
                    body_keypoints = [0.0] * 54 
                    num_points_to_copy = min(18, len(original_keypoints) // 3)
                    for i in range(num_points_to_copy):
                        base_idx = i * 3
                        x = original_keypoints[base_idx]
                        y = original_keypoints[base_idx + 1]
                        confidence = original_keypoints[base_idx + 2]
                        if confidence > 0:
                            absolute_x = x * image_width
                            absolute_y = y * image_height
                            body_keypoints[base_idx] = absolute_x
                            body_keypoints[base_idx + 1] = absolute_y
                            body_keypoints[base_idx + 2] = confidence
                    processed_people.append({
                        "pose_keypoints_2d": body_keypoints
                    })
        
        # 3. 准备要写入文件的最终数据结构
        data_to_save = {
            "width": int(image_width),
            "height": int(image_height),
            "people": processed_people
        }

        # 4. 使用正确的路径处理和文件名计数逻辑
        output_dir = folder_paths.get_output_directory()
        full_output_folder, filename, _, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, output_dir, image_width, image_height)
        
        counter = 1
        try:
            existing_files = [f for f in os.listdir(full_output_folder) if f.startswith(filename + "_") and f.endswith(".json")]
            if existing_files:
                max_counter = 0
                for f in existing_files:
                    try:
                        num_str = f[len(filename)+1:-5]
                        num = int(num_str)
                        if num > max_counter:
                            max_counter = num
                    except ValueError:
                        continue
                counter = max_counter + 1
        except FileNotFoundError:
            pass

        final_filename = f"{filename}_{counter:05d}.json"
        file_path = os.path.join(full_output_folder, final_filename)

        # 5. 写入JSON文件
        with open(file_path, 'w') as f:
            json.dump(data_to_save, f, indent=4)

        print(f"Pose Saver: Saved pose data to {final_filename}")
        
        # ================== 【 核心修复 】 ==================
        # 这一行代码在之前的简化版中可能丢失了，现在恢复它
        result_filename = os.path.join(subfolder, final_filename) if subfolder else final_filename
        # ====================================================
        
        return {"ui": {"text": [result_filename]}, "result": (result_filename,)}

# ====================================================================================================
# ComfyUI 节点注册
# ====================================================================================================
NODE_CLASS_MAPPINGS = {
    "Nui.OpenPoseEditor": OpenPoseEditor,
    "SavePoseToJson": SavePoseToJson  # 如果您还想用它，就保留
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Nui.OpenPoseEditor": "OpenPose Editor (DWPose Integrated)", # 新名字
    "SavePoseToJson": "Save Pose to JSON (from Keypoint)"
}