import os.path
import folder_paths
from nodes import LoadImage
import json
import time

# ====================================================================================================
# 节点 1: OpenPose Editor
# ====================================================================================================
class OpenPoseEditor:
    @classmethod
    def INPUT_TYPES(s):
        return {"required":
                    {
                        "image": ("STRING", { "default": "" }),
                    },
                }
    @classmethod
    def IS_CHANGED(s, image, **kwargs):
        """
        这个方法是解决缓存问题的关键。
        ComfyUI 在执行前会调用它，来判断节点是否需要重新运行。
        我们返回当前的时间戳，因为每次运行时间戳都不同，
        所以 ComfyUI 会认为节点“总是变化的”，从而强制重新执行 get_images 函数。
        """
        return time.time()
    RETURN_TYPES = ("IMAGE", "IMAGE",)
    RETURN_NAMES = ("pose_image", "combined_image",)
    FUNCTION = "get_images"
    CATEGORY = "image"

    def get_images(self, image):
        print(f"[DEBUG_BACKEND] {time.strftime('%H:%M:%S')} - get_images() EXECUTED.")
        print(f"[DEBUG_BACKEND] Received image filename: {image}")
        # 1. 加载第一个输出：纯姿态图
        pose_image, pose_mask = LoadImage.load_image(self, image)

        # 2. 根据第一个图像的文件名，推断出第二个图像的文件名
        base_name, ext = os.path.splitext(image)
        combined_image_name = f"{base_name}_combined{ext}"
        
        # 3. 检查并加载第二个输出：带背景的合成图
        combined_image_path = folder_paths.get_annotated_filepath(combined_image_name)
        
        if not os.path.exists(combined_image_path):
            print("OpenPose Editor: Combined image not found, returning pose image for both outputs.")
            return (pose_image, pose_image)

        combined_image, combined_mask = LoadImage.load_image(self, combined_image_name)
        
        return (pose_image, combined_image)

# ====================================================================================================
# 节点 2: Save Pose to JSON (最终合并版)
# ====================================================================================================
class SavePoseToJson:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",), 
                "pose_keypoint": ("POSE_KEYPOINT",),
                "filename_prefix": ("STRING", {"default": "json/poses/pose"})
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("filename",)
    FUNCTION = "save_json"
    OUTPUT_NODE = True
    CATEGORY = "image"

    def save_json(self, pose_keypoint, image, filename_prefix="pose"):
        # 1. 从 image 张量中自动获取宽度和高度 (来自您的正确版本)
        image_height, image_width = image.shape[1:3]
        
        # 2. 从复杂的 POSE_KEYPOINT 数据中提取出纯净的 "people" 列表 (来自您的正确版本)
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
        
        # 3. 准备要写入文件的最终数据结构 (来自您的正确版本)
        data_to_save = {
            "width": int(image_width),
            "height": int(image_height),
            "people": processed_people
        }

        # 4. 使用正确的路径处理和文件名计数逻辑 (来自我的修复版本)
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

        # 5. 写入JSON文件并返回结果 (来自您的正确版本)
        with open(file_path, 'w') as f:
            json.dump(data_to_save, f, indent=4)

        print(f"OpenPose Editor: Saved pose data to {final_filename}")
        
        result_filename = os.path.join(subfolder, final_filename) if subfolder else final_filename
        return {"ui": {"text": [result_filename]}, "result": (result_filename,)}

# ====================================================================================================
# ComfyUI 节点注册
# ====================================================================================================
NODE_CLASS_MAPPINGS = {
    "Nui.OpenPoseEditor": OpenPoseEditor,
    "SavePoseToJson": SavePoseToJson
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Nui.OpenPoseEditor": "OpenPose Editor",
    "SavePoseToJson": "Save Pose to JSON"
}