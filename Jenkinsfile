pipeline {
    agent any

    environment {
        BACKEND_DIR = '/var/www/iic-app/backend'
        FRONTEND_DIR = '/var/www/iic-app/frontend'
        BACKEND_PYTHON = '/var/www/iic-app/backend/venv/bin/python'
        BACKEND_PIP = '/var/www/iic-app/backend/venv/bin/pip'
        PNPM = '/usr/bin/pnpm'
    }

    stages {

        stage('Backend - Install Dependencies') {
            steps {
                sh '''
                    set -e
                    cd backend
                    "$BACKEND_PIP" install -r requirements.txt
                '''
            }
        }

        stage('Backend - Validate') {
            steps {
                sh '''
                    set -e
                    cd backend
                    "$BACKEND_PYTHON" manage.py check
                '''
            }
        }

        stage('Backend - Tests') {
            steps {
                sh '''
                    set -e
                    cd backend
                    "$BACKEND_PYTHON" manage.py test
                '''
            }
        }

        stage('Frontend - Install Dependencies') {
            steps {
                sh '''
                    set -e
                    cd frontend
                    "$PNPM" install --frozen-lockfile
                '''
            }
        }

        stage('Frontend - Build') {
            steps {
                sh '''
                    set -e
                    cd frontend
                    "$PNPM" build
                '''
            }
        }

        stage('Deploy Backend') {
            steps {
                sh '''
                    set -e

                    echo "Deploying backend..."

                    rsync -a \
                        --no-owner \
                        --no-group \
                        --no-times \
                        --no-perms \
                        --delete \
                        --exclude='.env' \
                        --exclude='venv/' \
                        --exclude='db.sqlite3' \
                        --exclude='media/' \
                        --exclude='staticfiles/' \
                        --exclude='__pycache__/' \
                        backend/ \
                        "$BACKEND_DIR"/

                    echo "Backend deployed."
                '''
            }
        }

        stage('Backend - Database Migration') {
            steps {
                sh '''
                    set -e

                    echo "Running database migrations..."

                    sudo -n -u iicapp \
                        "$BACKEND_PYTHON" \
                        "$BACKEND_DIR/manage.py" \
                        migrate --noinput

                    echo "Database migrations completed."
                '''
            }
        }

        stage('Backend - Collect Static') {
            steps {
                sh '''
                    set -e

                    echo "Collecting static files..."

                    sudo -n -u iicapp \
                        "$BACKEND_PYTHON" \
                        "$BACKEND_DIR/manage.py" \
                        collectstatic --noinput

                    echo "Static files collected."
                '''
            }
        }

        stage('Deploy Frontend') {
            steps {
                sh '''
                    set -e

                    echo "Deploying frontend..."

                    rsync -a \
                        --no-owner \
                        --no-group \
                        --no-times \
                        --no-perms \
                        --delete \
                        --exclude='node_modules/' \
                        frontend/ \
                        "$FRONTEND_DIR"/

                    echo "Frontend deployed."
                '''
            }
        }

        stage('Frontend - Install Production Dependencies') {
            steps {
                sh '''
                    set -e

                    cd "$FRONTEND_DIR"

                    "$PNPM" install --frozen-lockfile
                '''
            }
        }

        stage('Restart Backend') {
            steps {
                sh '''
                    set -e

                    echo "Restarting backend..."

                    sudo -n /usr/bin/systemctl \
                        restart iic-helpdesk-backend.service

                    echo "Backend restarted."
                '''
            }
        }

        stage('Restart Frontend') {
            steps {
                sh '''
                    set -e

                    echo "Restarting frontend..."

                    sudo -n /usr/bin/systemctl \
                        restart iic-helpdesk-frontend.service

                    echo "Frontend restarted."
                '''
            }
        }

        stage('Health Check') {
            steps {
                sh '''
                    set -e

                    echo "Checking backend..."

                    curl --fail --silent --show-error \
                        http://127.0.0.1:8000/api/v1/health/

                    echo

                    echo "Checking frontend..."

                    curl --fail --silent --show-error \
                        http://127.0.0.1:3000/ \
                        > /dev/null

                    echo "All health checks passed."
                '''
            }
        }
    }

    post {
        success {
            echo 'IIC IT Helpdesk deployment completed successfully.'
        }

        failure {
            echo 'IIC IT Helpdesk deployment failed.'
        }

        always {
            echo "Build: ${env.BUILD_NUMBER}"
            echo "Result: ${currentBuild.currentResult}"
        }
    }
}