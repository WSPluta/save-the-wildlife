#!/usr/bin/env python3
"""Import and publish a Private Agent Factory Canvas flow.

This script is intentionally narrow for the Save the Wildlife demo. It uses SSH
to run a short Python program inside the PAF container, then inserts or updates
one flow graph in the PAF application database.
"""

from __future__ import annotations

import argparse
import base64
import json
import shlex
import subprocess
import sys
from pathlib import Path


DEFAULT_CONTAINER = "oracle-applied-ai-label"
DEFAULT_REMOTE_PYTHON = "/home/aaiuser/install/agent_factory/third_party/python3/bin/python3"
SUPPORTED_NODE_TYPES = {
    "agentStep",
    "bugTool",
    "Calculator",
    "chatInputComponent",
    "chatOutputComponent",
    "conditionalRouterComponent",
    "delayComponent",
    "loopComponent",
    "mcpServer",
    "promptComponent",
    "restAPITools",
    "structuredOutputComponent",
    "webSearchTool",
}


def set_manifest_llm_config(value: object, llm_config_name: str) -> None:
    if isinstance(value, dict):
        if value.get("type") == "agentStep" and isinstance(value.get("template"), dict):
            template = value["template"]
            if isinstance(template.get("llmToUse"), dict):
                template["llmToUse"]["value"] = llm_config_name
        for item in value.values():
            set_manifest_llm_config(item, llm_config_name)
    elif isinstance(value, list):
        for item in value:
            set_manifest_llm_config(item, llm_config_name)


def set_manifest_mcp_url(value: object, mcp_server_url: str) -> None:
    if not mcp_server_url:
        return
    if isinstance(value, dict):
        if value.get("type") == "mcpServer" and isinstance(value.get("template"), dict):
            template = value["template"]
            for key in ("serverUrl", "server_url", "url", "endpoint", "mcpServerUrl"):
                if isinstance(template.get(key), dict):
                    template[key]["value"] = mcp_server_url
        for item in value.values():
            set_manifest_mcp_url(item, mcp_server_url)
    elif isinstance(value, list):
        for item in value:
            set_manifest_mcp_url(item, mcp_server_url)


def validate_manifest(manifest: dict) -> list[str]:
    issues: list[str] = []
    nodes = manifest.get("nodes")
    edges = manifest.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return ["manifest must contain top-level nodes and edges lists"]

    node_ids: set[str] = set()
    connected_ids: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict):
            issues.append("node entry is not an object")
            continue
        node_id = str(node.get("id") or "")
        if not node_id:
            issues.append("node is missing id")
            continue
        node_ids.add(node_id)
        data = node.get("data", {})
        node_type = data.get("type") if isinstance(data, dict) else None
        if node_type not in SUPPORTED_NODE_TYPES:
            issues.append(f"unsupported node type {node_type!r} on node {node_id}")

    for edge in edges:
        if not isinstance(edge, dict):
            issues.append("edge entry is not an object")
            continue
        source = str(edge.get("source") or "")
        target = str(edge.get("target") or "")
        if source not in node_ids:
            issues.append(f"edge references missing source node {source!r}")
        else:
            connected_ids.add(source)
        if target not in node_ids:
            issues.append(f"edge references missing target node {target!r}")
        else:
            connected_ids.add(target)

    if len(node_ids) > 1:
        orphan_ids = sorted(node_ids - connected_ids)
        if orphan_ids:
            issues.append("orphan canvas nodes detected: " + ", ".join(orphan_ids))
    return issues


def build_remote_script(
    *,
    manifest: dict,
    flow_name: str,
    flow_description: str,
    agent_factory_user: str | None,
    llm_config_name: str,
    publish: bool,
    require_llm_config: bool,
) -> str:
    manifest_b64 = base64.b64encode(
        json.dumps(manifest, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).decode("ascii")
    return f"""
import base64
import json

from agent_factory.app.util.common import CommonUtil
from agent_factory.app.util.db_utils import DBUtil

manifest = json.loads(base64.b64decode({manifest_b64!r}).decode("utf-8"))
flow_name = {flow_name!r}
flow_description = {flow_description!r}
agent_factory_user = {agent_factory_user!r}
llm_config_name = {llm_config_name!r}
publish = {bool(publish)!r}
require_llm_config = {bool(require_llm_config)!r}


def rows(sql, data=None):
    return DBUtil.exec_query(sql, data=data or {{}}, stringOutput=False) or []


def find_agent_factory_user():
    if agent_factory_user:
        return agent_factory_user
    user_rows = rows("select user_id from aai_users where user_id is not null fetch first 1 row only")
    if not user_rows:
        raise SystemExit("No Private Agent Factory user was found. Complete user registration first or pass --agent-factory-user.")
    return user_rows[0]["USER_ID"]


def llm_is_registered():
    try:
        from agent_factory.app.util.llmConnectionManager import LLMConnectionManager

        entries = LLMConnectionManager.get_all_llm_connection_entries() or []
        return any(entry.get("name") == llm_config_name for entry in entries)
    except Exception:
        return False


user_id = find_agent_factory_user()
llm_configured = llm_is_registered()
if require_llm_config and not llm_configured:
    raise SystemExit(f"LLM configuration {{llm_config_name!r}} is not registered for Private Agent Factory.")

data_text = json.dumps(manifest, separators=(",", ":"), ensure_ascii=False)
existing = rows(
    "select id from aai_agent_builder where user_id = :user_id and name = :name fetch first 1 row only",
    {{"user_id": user_id, "name": flow_name}},
)

if existing:
    agent_id = existing[0]["ID"]
    DBUtil.exec_query(
        \"\"\"
        update aai_agent_builder
           set description = :description,
               icon = :icon,
               category = :category,
               flow_graph = 1,
               data = :data,
               tools_python_script = null,
               import_file_type = null,
               updated_at = sysdate
         where id = :agent_id
           and user_id = :user_id
        \"\"\",
        data={{
            "description": flow_description,
            "icon": "workflow",
            "category": 1,
            "data": data_text,
            "agent_id": agent_id,
            "user_id": user_id,
        }},
        commit=1,
    )
    action = "updated"
else:
    id_rows = CommonUtil.getQueryResults("agent_builder", "get_next_id", data={{}}) or []
    agent_id = id_rows[0]["NEW_ID"]
    DBUtil.exec_query(
        \"\"\"
        insert into aai_agent_builder
          (id, user_id, name, icon, description, published, created_at, updated_at, category, flow_graph, data, tools_python_script, import_file_type)
        values
          (:id, :user_id, :name, :icon, :description, 0, sysdate, sysdate, :category, 1, :data, null, null)
        \"\"\",
        data={{
            "id": agent_id,
            "user_id": user_id,
            "name": flow_name,
            "icon": "workflow",
            "description": flow_description,
            "category": 1,
            "data": data_text,
        }},
        commit=1,
    )
    action = "created"

if publish:
    DBUtil.exec_query(
        "update aai_agent_builder set published = 1, updated_at = sysdate where id = :agent_id and user_id = :user_id",
        data={{"agent_id": agent_id, "user_id": user_id}},
        commit=1,
    )

summary_rows = rows(
    \"\"\"
    select id as agent_id,
           user_id,
           name,
           published,
           flow_graph,
           icon,
           to_char(updated_at, 'yyyy-mm-dd"T"hh24:mi:ss') as updated_at,
           dbms_lob.getlength(data) as data_length
      from aai_agent_builder
     where id = :agent_id
    \"\"\",
    {{"agent_id": agent_id}},
)
summary = summary_rows[0] if summary_rows else {{"AGENT_ID": agent_id}}
result = {{
    "action": action,
    "agent_id": agent_id,
    "flow_name": flow_name,
    "user_id": user_id,
    "published": bool(summary.get("PUBLISHED") or summary.get("published")),
    "flow_graph": int(summary.get("FLOW_GRAPH") or summary.get("flow_graph") or 0),
    "data_length": int(summary.get("DATA_LENGTH") or summary.get("data_length") or 0),
    "llm_config_name": llm_config_name,
    "llm_configured": bool(llm_configured),
    "node_count": len(manifest.get("nodes", [])),
    "edge_count": len(manifest.get("edges", [])),
}}
print("STWL_PAF_CANVAS_RESULT " + json.dumps(result, sort_keys=True))
"""


def run(args: argparse.Namespace) -> int:
    manifest_path = Path(args.manifest).expanduser().resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    set_manifest_llm_config(manifest, args.llm_config_name)
    set_manifest_mcp_url(manifest, args.mcp_server_url)
    issues = validate_manifest(manifest)
    if issues:
        print("PAF Canvas manifest validation failed:\n- " + "\n- ".join(issues), file=sys.stderr)
        return 2
    if args.validate_only:
        mcp_urls: list[str] = []

        def collect_mcp_urls(value: object) -> None:
            if isinstance(value, dict):
                if value.get("type") == "mcpServer" and isinstance(value.get("template"), dict):
                    for key in ("serverUrl", "server_url", "url", "endpoint", "mcpServerUrl"):
                        field = value["template"].get(key)
                        if isinstance(field, dict) and field.get("value"):
                            mcp_urls.append(str(field["value"]))
                for item in value.values():
                    collect_mcp_urls(item)
            elif isinstance(value, list):
                for item in value:
                    collect_mcp_urls(item)

        collect_mcp_urls(manifest)
        print("STWL_PAF_CANVAS_VALIDATE " + json.dumps({
            "ok": True,
            "node_count": len(manifest.get("nodes", [])),
            "edge_count": len(manifest.get("edges", [])),
            "mcp_urls": mcp_urls,
        }, sort_keys=True))
        return 0

    remote_script = build_remote_script(
        manifest=manifest,
        flow_name=args.flow_name,
        flow_description=args.flow_description,
        agent_factory_user=args.agent_factory_user,
        llm_config_name=args.llm_config_name,
        publish=not args.no_publish,
        require_llm_config=args.require_llm_config,
    )
    remote_command = (
        f"podman exec -i {shlex.quote(args.container)} bash -lc "
        + shlex.quote(
            "source /mount/config/app/latest/backend/source_env.sh; "
            "cd /home/aaiuser/install; "
            "export PYTHONPATH=/home/aaiuser/install:/home/aaiuser/install/agent_factory; "
            f"{args.remote_python} -"
        )
    )
    ssh_target = f"{args.ssh_user}@{args.paf_ip}"
    command = [
        "ssh",
        "-i",
        str(Path(args.ssh_key).expanduser()),
        "-o",
        "StrictHostKeyChecking=no",
        ssh_target,
        remote_command,
    ]
    print(f"+ ssh -i {shlex.quote(args.ssh_key)} {ssh_target} 'podman exec ... {args.remote_python} -'")
    result = subprocess.run(command, input=remote_script, text=True, capture_output=True, check=False)
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")
    if result.returncode != 0:
        return result.returncode

    marker = "STWL_PAF_CANVAS_RESULT "
    summary = None
    for line in result.stdout.splitlines():
        if line.startswith(marker):
            summary = json.loads(line[len(marker):])
    if not summary:
        print("PAF Canvas import did not return a result marker.", file=sys.stderr)
        return 1
    if summary.get("published"):
        print(f"run_endpoint_url=https://{args.paf_ip}:8080/agentFactory/v1/agentBuilder/run/{summary['agent_id']}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Import a Save the Wildlife PAF Canvas flow.")
    parser.add_argument("--paf-ip", required=True)
    parser.add_argument("--ssh-key", required=True)
    parser.add_argument("--ssh-user", default="opc")
    parser.add_argument("--container", default=DEFAULT_CONTAINER)
    parser.add_argument("--remote-python", default=DEFAULT_REMOTE_PYTHON)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--flow-name", required=True)
    parser.add_argument("--flow-description", required=True)
    parser.add_argument("--agent-factory-user")
    parser.add_argument("--llm-config-name", default="llm_model_entry")
    parser.add_argument("--mcp-server-url", default="")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--require-llm-config", action="store_true")
    parser.add_argument("--no-publish", action="store_true")
    return run(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
