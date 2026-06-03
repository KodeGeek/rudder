import os
import sys

# Make `import app.*` resolve when pytest runs from control-plane/.
sys.path.insert(0, os.path.dirname(__file__))
