pipeline {
    agent any

    environment {
        AWS_REGION            = 'us-east-1'
        ECR_REPO              = '621646470863.dkr.ecr.us-east-1.amazonaws.com/hello-world-app'
        CLUSTER_NAME          = 'hello-world-cluster'
        AWS_ACCESS_KEY_ID     = credentials('aws-access-key-id')
        AWS_SECRET_ACCESS_KEY = credentials('aws-secret-access-key')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build & Push to ECR') {
            steps {
                sh '''
                    aws ecr get-login-password --region $AWS_REGION | \
                    docker login --username AWS --password-stdin $ECR_REPO

                    docker build --platform linux/amd64 \
                        -t $ECR_REPO:$GIT_COMMIT \
                        -t $ECR_REPO:latest \
                        ./hello-world-app

                    docker push $ECR_REPO:$GIT_COMMIT
                    docker push $ECR_REPO:latest
                '''
            }
        }

        stage('Configure kubectl') {
            steps {
                sh '''
                    aws eks update-kubeconfig \
                        --name $CLUSTER_NAME \
                        --region $AWS_REGION \
                        --kubeconfig /tmp/kubeconfig
                '''
            }
        }

        stage('Deploy with Helm') {
            steps {
                sh '''
                    export KUBECONFIG=/tmp/kubeconfig
                    helm upgrade --install hello-world ./helm/hello-world \
                        --set image.repository=$ECR_REPO \
                        --set image.tag=$GIT_COMMIT \
                        --wait
                '''
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            echo 'Deployment successful!'
        }
        failure {
            echo 'Deployment failed!'
        }
    }
}