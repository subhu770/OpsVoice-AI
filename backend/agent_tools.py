# agent_tools.py
# Mock DevOps engine and tool definitions for AssemblyAI Voice Agent Integration

# In-memory cluster state simulating an active SRE incident
cluster_state = {
    "services": {
        "auth-service": {
            "status": "CrashLoopBackOff",
            "replicas": "0/1",
            "cpu": "0%",
            "memory": "512Mi / 512Mi (OOMKilled)",
            "memory_limit": 512,  # in Mi
            "restarts": 14,
            "role": "Handles user login, session management, and authentication tokens."
        },
        "payment-gateway": {
            "status": "Running",
            "replicas": "1/1",
            "cpu": "12%",
            "memory": "256Mi / 512Mi",
            "memory_limit": 512,
            "restarts": 0,
            "role": "Processes credit card and digital wallet transactions via Stripe."
        },
        "db-replica": {
            "status": "Running",
            "replicas": "1/1",
            "cpu": "64%",
            "memory": "1.2Gi / 2Gi",
            "memory_limit": 2048,
            "restarts": 1,
            "role": "PostgreSQL read replica for user profiles and transaction history."
        }
    },
    "metrics": {
        "cluster_cpu": "38%",
        "cluster_memory": "82%",
        "active_alerts": 1
    }
}

def get_cluster_state():
    """Returns the raw cluster state dictionary."""
    return cluster_state

def check_cluster_health():
    """Checks the overall status of the cluster and service metrics."""
    unhealthy = [k for k, v in cluster_state["services"].items() if v["status"] != "Running"]
    
    report = "OpsVoice Cluster Health Status Report:\n"
    report += f"- Total Active Alerts: {cluster_state['metrics']['active_alerts']}\n"
    report += f"- Global CPU Utilization: {cluster_state['metrics']['cluster_cpu']}\n"
    report += f"- Global Memory Utilization: {cluster_state['metrics']['cluster_memory']}\n"
    report += "- Pod Metrics:\n"
    
    for name, info in cluster_state["services"].items():
        report += f"  * {name}: {info['status']} | Replicas: {info['replicas']} | Memory: {info['memory']} | Restarts: {info['restarts']}\n"
        
    if unhealthy:
        report += f"\nCRITICAL ALERT: Service {', '.join(unhealthy)} is currently failing. Check logs for details or request a container restart."
    else:
        report += "\nAll pods are currently running and healthy."
        
    return report

def get_logs(service_name):
    """Fetches diagnostic logs for the specified service."""
    service_name = service_name.lower().strip()
    if service_name not in cluster_state["services"]:
        return f"Error: Service '{service_name}' not found. Available services: auth-service, payment-gateway, db-replica."
        
    if service_name == "auth-service":
        return """[2026-08-28 19:40:02] INFO Starting auth-service v2.4.1...
[2026-08-28 19:40:03] INFO Connecting to database db-replica:5432...
[2026-08-28 19:40:05] INFO Database connection established. Initializing auth tokens cache.
[2026-08-28 19:41:10] WARN Memory saturation threshold exceeded: 98% (502MB/512MB)
[2026-08-28 19:41:12] ERROR Fatal error: OutOfMemory. JVM garbage collection overhead limit exceeded.
[2026-08-28 19:41:12] FATAL Container exited with code 137 (OOMKilled)"""
    elif service_name == "payment-gateway":
        return """[2026-08-28 19:40:05] INFO Starting payment-gateway v1.1.2...
[2026-08-28 19:40:06] INFO Stripe payment processor initialized in sandbox mode.
[2026-08-28 19:42:00] INFO POST /v1/charge - 200 OK - 145ms
[2026-08-28 19:43:15] INFO POST /v1/refund - 200 OK - 89ms"""
    elif service_name == "db-replica":
        return """[2026-08-28 19:35:00] INFO PostgreSQL Database server version 16.2 initialized.
[2026-08-28 19:35:01] INFO Ready to accept incoming TCP connections on port 5432.
[2026-08-28 19:40:00] INFO Autovacuum daemon started.
[2026-08-28 19:42:10] INFO Replication lag with database-primary is stable: 12ms."""
    
    return f"No logs recorded for {service_name}."

def restart_pod(service_name, memory_bump=False):
    """Restarts a specific container service, optionally applying a memory ceiling limit increase."""
    service_name = service_name.lower().strip()
    if service_name not in cluster_state["services"]:
        return f"Error: Service '{service_name}' not found."
        
    svc = cluster_state["services"][service_name]
    
    if service_name == "auth-service":
        if memory_bump:
            svc["status"] = "Running"
            svc["replicas"] = "1/1"
            svc["cpu"] = "14%"
            svc["memory"] = "640Mi / 1024Mi"
            svc["memory_limit"] = 1024
            svc["restarts"] = 0
            cluster_state["metrics"]["cluster_memory"] = "62%"
            cluster_state["metrics"]["active_alerts"] = 0
            return "SUCCESS: Container auth-service restarted successfully. Memory limits have been raised from 512Mi to 1024Mi. Pod is now healthy and active, alerts cleared."
        else:
            svc["status"] = "Running"
            svc["replicas"] = "1/1"
            svc["restarts"] += 1
            svc["cpu"] = "3%"
            svc["memory"] = "509Mi / 512Mi"
            return "WARNING: Container auth-service was restarted, but the memory limit remained capped at 512Mi. The service is temporarily active but running close to memory exhaustion limits. Recommend memory bump."
    else:
        svc["status"] = "Running"
        svc["replicas"] = "1/1"
        svc["restarts"] += 1
        return f"SUCCESS: Container {service_name} has been restarted. Status: Running, replicas: 1/1."

def generate_post_mortem(incident_description=None):
    """Generates an incident post-mortem markdown report."""
    if not incident_description:
        incident_description = "auth-service outage due to container OOMKilled exception."
        
    report = f"""# SRE Incident Post-Mortem Report

## Executive Summary
*   **Incident Reference**: INC-2026-08-28
*   **Service Outage**: `auth-service`
*   **Severity**: Critical SEV-1
*   **Status**: RESOLVED
*   **Resolution Method**: Voice Command (OpsVoice AI Assistant)

## Description of Incident
{incident_description}
The authentication service experienced a hard crash when its memory consumption crossed the resource limit boundary of 512Mi. The pod entered a CrashLoopBackOff state, preventing logins and token validation across the cluster.

## Root Cause Analysis (RCA)
1. **Low Resource Allocation**: The service was restricted to a maximum memory ceiling of 512Mi.
2. **Load Spike**: An unexpected influx of authentications caused cache storage to exceed limit lines.
3. **Out Of Memory**: The Kubernetes engine triggered the OOM killer daemon (code 137), forcing the container to crash.

## Action Taken & Resolution
1. SRE triggered the `check_cluster_health` tool via voice and identified the crashed `auth-service` container.
2. SRE examined the logs using `get_logs` and confirmed the `OOMKilled` crash code.
3. SRE commanded the agent to restart the container with a memory bump using: *"Restart auth-service with a memory bump"*.
4. OpsVoice AI executed `restart_pod(service_name="auth-service", memory_bump=True)`.
5. The container memory limit was increased to 1024Mi, the pod successfully restarted, and traffic flow was restored.

## Ongoing Action Items
*   [ ] Optimize session cache eviction schedules.
*   [ ] Adjust resource alerting limits from 100% threshold to 80% saturation warning.
*   [ ] Review scaling triggers to scale pods horizontally under traffic load.
"""
    return report

def execute_devops_tool(name, args):
    """Router to execute local SRE DevOps functions."""
    try:
        if name == "check_cluster_health":
            return check_cluster_health()
        elif name == "get_logs":
            return get_logs(args.get("service_name", ""))
        elif name == "restart_pod":
            return restart_pod(
                args.get("service_name", ""),
                args.get("memory_bump", False)
            )
        elif name == "generate_post_mortem":
            return generate_post_mortem(args.get("incident_description"))
        else:
            return f"Error: SRE DevOps Tool '{name}' is not recognized."
    except Exception as e:
        return f"Error executing tool '{name}': {str(e)}"

# JSON Tool schemas for AssemblyAI Voice Agent session.update configuration
TOOLS_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "check_cluster_health",
            "description": "Checks the overall status of the cluster, current CPU/Memory resource metrics, and lists active alarms or crashed pods."
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_logs",
            "description": "Retrieves recent stdout/stderr diagnostic logs for a specific service in the cluster to identify error roots.",
            "parameters": {
                "type": "object",
                "properties": {
                    "service_name": {
                        "type": "string",
                        "description": "The exact service name, select from: auth-service, payment-gateway, or db-replica."
                    }
                },
                "required": ["service_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "restart_pod",
            "description": "Restarts a service container. Can optionally scale up or 'memory bump' the RAM limit to prevent immediate crash loops on high load.",
            "parameters": {
                "type": "object",
                "properties": {
                    "service_name": {
                        "type": "string",
                        "description": "The exact service name, select from: auth-service, payment-gateway, or db-replica."
                    },
                    "memory_bump": {
                        "type": "boolean",
                        "description": "Enable this flag to increase the container memory limit during restart. Recommended if logs show OOMKilled or memory allocation failures."
                    }
                },
                "required": ["service_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_post_mortem",
            "description": "Generates a complete post-mortem report in markdown, outlining incident duration, RCA, resolution steps, and prevention items.",
            "parameters": {
                "type": "object",
                "properties": {
                    "incident_description": {
                        "type": "string",
                        "description": "A description of the outage reason (e.g. auth-service OOM outage resolved by memory bump)."
                    }
                }
            }
        }
    }
]
