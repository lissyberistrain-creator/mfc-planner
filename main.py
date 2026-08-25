from fastapi import FastAPI
from pydantic import BaseModel
from datetime import datetime

app = FastAPI(title="MFC Planner Cloud API")

projects = {}

class Project(BaseModel):
    name: str
    layout: dict = {}

@app.get("/health")
def health():
    return {"status":"ok"}

@app.get("/projects")
def get_projects():
    return list(projects.values())

@app.post("/projects")
def create_project(project: Project):
    pid = str(len(projects)+1)
    item = {
        "id": pid,
        "name": project.name,
        "layout": project.layout,
        "updated_at": datetime.now().isoformat()
    }
    projects[pid]=item
    return item

@app.get("/projects/{project_id}")
def get_project(project_id: str):
    return projects.get(project_id)
