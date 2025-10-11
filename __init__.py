# 在 __init__.py 文件中...

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

# --- 【从这里开始修改】 ---
# 从 nodes.py 导入我们新创建的类
from .nodes import SavePoseToJson

# 将新节点添加到 MAPPINGS 字典中
NODE_CLASS_MAPPINGS["SavePoseToJson"] = SavePoseToJson
NODE_DISPLAY_NAME_MAPPINGS["SavePoseToJson"] = "Save Pose to JSON"
# --- 【到这里修改结束】 ---

WEB_DIRECTORY = "./js"
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']

# ... (文件后面的 update_javascript() 等函数保持不变) ...