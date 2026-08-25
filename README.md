# Tech Challenge — Application Deployment

> Containerization · Infrastructure as Code · Kubernetes · CI/CD · GitOps

A production-grade deployment of a Node.js Hello World application using Docker, AWS EKS, Terraform, Jenkins, and a GitOps bonus track with GitHub Actions and Argo CD.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Repository Structure](#repository-structure)
- [Phase 1 — Web Application](#phase-1--web-application)
- [Phase 2 — Docker](#phase-2--docker)
- [Phase 3 — Kubernetes and EKS](#phase-3--kubernetes-and-eks)
- [Phase 4 — Jenkins CI/CD](#phase-4--jenkins-cicd)
- [Bonus — GitOps with GitHub Actions and Argo CD](#bonus--gitops-with-github-actions-and-argo-cd)
- [Deployed Application URL](#deployed-application-url)
- [Known Limitations](#known-limitations)

---

## Project Overview

This project demonstrates the full lifecycle of deploying a web application to a production-grade cloud environment:

1. A **Node.js/Express** app with a `/health` endpoint for Kubernetes probes
2. **Dockerized** using a multi-stage build for a minimal, secure image
3. **Infrastructure provisioned** on AWS using Terraform (VPC, EKS, IAM)
4. **Deployed to Kubernetes** using Helm with HPA autoscaling
5. **CI/CD pipeline** via Jenkins — builds, pushes to ECR, and deploys on every commit
6. **GitOps alternative** on the `gitops` branch using GitHub Actions and Argo CD

---

## Architecture

```
GitHub (main branch)
    |
    Jenkins Pipeline
        ├── docker build --platform linux/amd64
        ├── docker push → Amazon ECR
        └── helm upgrade --install → AWS EKS
                ├── Deployment (1 pod, HPA 1-3)
                ├── Service (ClusterIP)
                ├── Ingress (ALB)
                └── HPA (50% CPU / 50% memory)

GitHub (gitops branch)
    |
    GitHub Actions CI
        ├── docker buildx → Amazon ECR
        └── updates helm/hello-world/values.yaml → git commit
                |
                Argo CD (auto-sync)
                    └── helm upgrade --install → AWS EKS
```

**EKS Cluster spec:**
- 4 x t3.small nodes (min: 1, max: 4, autoscaling)
- AWS Application Load Balancer (ALB) via ingress
- HPA: 1-3 pods per node, triggers at 50% CPU or 50% memory

---

## Prerequisites

| Tool | Install |
|------|---------|
| AWS CLI v2 | `brew install awscli` |
| Terraform v1.3+ | `brew install terraform` |
| kubectl v1.31+ | `brew install kubectl` |
| Helm v3+ | `brew install helm` |
| Docker Desktop | https://docker.com |
| Node.js v18+ | `brew install node` |

Configure AWS:

```bash
aws configure
# Use a dedicated IAM user — never the root account
# Region: us-east-1
```

---

## Repository Structure

```
Application_Deployment/
├── hello-world-app/
│   ├── src/index.js          # Express server — GET / and GET /health
│   ├── Dockerfile            # Multi-stage build, non-root user
│   ├── .dockerignore
│   └── package.json
├── terraform/
│   ├── main.tf               # Provider config
│   ├── variables.tf          # Region, instance type, node counts
│   ├── outputs.tf            # Cluster endpoint, kubeconfig command
│   ├── vpc.tf                # VPC, subnets, NAT gateways, route tables
│   └── eks.tf                # EKS cluster + managed node group
├── helm/
│   └── hello-world/
│       ├── Chart.yaml
│       ├── values.yaml
│       └── templates/
│           ├── deployment.yaml
│           ├── service.yaml
│           ├── ingress.yaml
│           └── hpa.yaml
├── Jenkinsfile
├── .github/workflows/ci.yml  # GitHub Actions (gitops branch only)
└── README.md
```

---

## Phase 1 — Web Application

A minimal Node.js/Express server with two endpoints:

- `GET /` — Hello World HTML page
- `GET /health` — `{"status":"ok","uptime":...}` — **required for Kubernetes liveness/readiness probes**

```bash
cd hello-world-app
npm install
npm start
# http://localhost:3000
# http://localhost:3000/health
```

---

## Phase 2 — Docker

Two-stage Dockerfile:
- **Stage 1 (builder):** `node:20-alpine`, installs only production deps with `npm ci --only=production`
- **Stage 2 (runtime):** copies app, sets non-root user `appuser`, exposes port 3000

```bash
cd hello-world-app

# Local test
docker build -t hello-world-app:latest .
docker run -p 3000:3000 hello-world-app:latest

# Build for EKS (linux/amd64 required — Mac ARM will cause ImagePullBackOff on EKS)
docker buildx build --platform linux/amd64 \
  -t 621646470863.dkr.ecr.us-east-1.amazonaws.com/hello-world-app:latest \
  --push .
```

---

## Phase 3 — Kubernetes and EKS

### 1. Provision infrastructure

```bash
cd terraform
terraform init
terraform plan
terraform apply   # Takes 10-15 min
```

> Use `cluster_version = "1.31"` — Kubernetes 1.29 AMIs are deprecated in AWS.

### 2. Connect kubectl

```bash
aws eks update-kubeconfig --name hello-world-cluster --region us-east-1
kubectl get nodes
```

> If you get a credentials error, create an IAM user and add an EKS access entry:
> ```bash
> aws eks create-access-entry --cluster-name hello-world-cluster \
>   --principal-arn arn:aws:iam::ACCOUNT_ID:user/eks-admin --region us-east-1
> aws eks associate-access-policy --cluster-name hello-world-cluster \
>   --principal-arn arn:aws:iam::ACCOUNT_ID:user/eks-admin \
>   --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
>   --access-scope type=cluster --region us-east-1
> ```

### 3. Install AWS Load Balancer Controller

```bash
helm repo add eks https://aws.github.io/eks-charts && helm repo update

helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=hello-world-cluster \
  --set serviceAccount.create=true \
  --set region=us-east-1 \
  --set vpcId=$(aws ec2 describe-vpcs \
    --filters "Name=tag:Name,Values=hello-world-cluster-vpc" \
    --query "Vpcs[0].VpcId" --output text --region us-east-1)
```

### 4. Attach IAM policies to node group role

```bash
NODE_ROLE=<your-node-group-role-name>

aws iam attach-role-policy --role-name $NODE_ROLE \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

aws iam attach-role-policy --role-name $NODE_ROLE \
  --policy-arn arn:aws:iam::aws:policy/ElasticLoadBalancingFullAccess

aws iam attach-role-policy --role-name $NODE_ROLE \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2FullAccess
```

### 5. Deploy with Helm

```bash
cd helm
helm install hello-world ./hello-world
kubectl get pods       # 1/1 Running
kubectl get hpa        # min:1 max:3
kubectl get ingress    # Wait 2-3 min for ALB address
```

### Terraform files explained

| File | What it does |
|------|-------------|
| `main.tf` | Configures AWS and Kubernetes providers |
| `variables.tf` | Defines region, cluster name, instance type, node min/max/desired |
| `vpc.tf` | Creates VPC, 2 public + 2 private subnets, NAT gateways, route tables |
| `eks.tf` | Provisions EKS control plane and managed node group using terraform-aws-modules/eks |
| `outputs.tf` | Outputs cluster name, endpoint, region, and the exact update-kubeconfig command |

---

## Phase 4 — Jenkins CI/CD

### Start Jenkins

```bash
docker run -d --name jenkins \
  -p 8080:8080 -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  jenkins/jenkins:lts
```

### Install tools in the container

```bash
# AWS CLI
docker exec -u root jenkins bash -c "
  apt-get update && apt-get install -y curl unzip docker.io &&
  curl 'https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip' -o awscliv2.zip &&
  unzip awscliv2.zip && ./aws/install"

# kubectl + helm
docker exec -u root jenkins bash -c "
  curl -LO 'https://dl.k8s.io/release/v1.31.0/bin/linux/arm64/kubectl' &&
  chmod +x kubectl && mv kubectl /usr/local/bin/ &&
  curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash"

# Docker socket permissions
docker exec -u root jenkins chmod 666 /var/run/docker.sock
```

### Credentials to add in Jenkins

| ID | Kind | Value |
|----|------|-------|
| `aws-access-key-id` | Secret text | IAM Access Key ID |
| `aws-secret-access-key` | Secret text | IAM Secret Access Key |
| `kubeconfig` | Secret file | `~/.kube/config` |
| `github-credentials` | Username/Password | GitHub username + PAT |

### Create the pipeline job

1. New Item → Pipeline → `hello-world-pipeline`
2. Definition: Pipeline script from SCM
3. SCM: Git — `https://github.com/cwhitaker777/Application_Deployment`
4. Branch: `*/main`  |  Script Path: `Jenkinsfile`
5. Build Triggers: GitHub hook trigger for GITScm polling

### Pipeline stages

| Stage | What happens |
|-------|-------------|
| Checkout | Clones repo from GitHub |
| Build & Push to ECR | Builds linux/amd64 image, tags with `$GIT_COMMIT`, pushes to ECR |
| Configure kubectl | Runs `aws eks update-kubeconfig` writing to `/tmp/kubeconfig` |
| Deploy with Helm | Runs `helm upgrade --install` with `--set image.tag=$GIT_COMMIT` |

---

## Bonus — GitOps with GitHub Actions and Argo CD

Switch to the `gitops` branch for this workflow. Every push triggers GitHub Actions to build and push the image, update `values.yaml` with the new tag, and commit it back. Argo CD then auto-syncs the Helm chart to EKS.

### GitHub Actions secrets required

| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | eks-admin Access Key ID |
| `AWS_SECRET_ACCESS_KEY` | eks-admin Secret Access Key |

### Install Argo CD

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f \
  https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Get admin password
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d

# Open UI
kubectl port-forward svc/argocd-server -n argocd 8081:443
# https://localhost:8081
```

### Add GitHub credentials to Argo CD

```bash
kubectl -n argocd create secret generic github-creds \
  --from-literal=type=git \
  --from-literal=url=https://github.com/cwhitaker777/Application_Deployment \
  --from-literal=username=YOUR_USERNAME \
  --from-literal=password=YOUR_PAT

kubectl -n argocd label secret github-creds \
  argocd.argoproj.io/secret-type=repository
```

### Register the application with Argo CD

```bash
kubectl apply -f - <<ARGOEOF
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: hello-world
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/cwhitaker777/Application_Deployment
    targetRevision: gitops
    path: helm/hello-world
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
ARGOEOF
```

---

## Deployed Application URL

```
http://k8s-default-hellowor-75ebf6ac54-882231177.us-east-1.elb.amazonaws.com
```

---

## Known Limitations

- Jenkins runs locally in Docker. GitHub webhooks require a public URL — use `ngrok http 8080` or deploy Jenkins to EC2.
- Always use a dedicated IAM user with EKS access entries, not the root account.
- Kubernetes 1.29 AMIs are deprecated — use 1.31 or later in `variables.tf`.
