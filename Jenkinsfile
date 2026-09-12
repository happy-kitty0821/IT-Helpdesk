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

                    echo "Installing backend dependencies..."

                    cd backend
                    "$BACKEND_PIP" install -r requirements.txt

                    echo "Backend dependencies installed."
                '''
            }
        }

        stage('Backend - Validate') {
            steps {
                sh '''
                    set -e

                    echo "Running Django system checks..."

                    cd backend
                    "$BACKEND_PYTHON" manage.py check

                    echo "Django validation passed."
                '''
            }
        }

        stage('Backend - Tests') {
            steps {
                sh '''
                    set -e

                    echo "Running backend tests..."

                    cd backend
                    "$BACKEND_PYTHON" manage.py test

                    echo "Backend tests passed."
                '''
            }
        }

        stage('Frontend - Install Dependencies') {
            steps {
                sh '''
                    set -e

                    echo "Installing frontend dependencies..."

                    cd frontend
                    "$PNPM" install --frozen-lockfile

                    echo "Frontend dependencies installed."
                '''
            }
        }

        stage('Frontend - Build') {
            steps {
                withCredentials([
                    string(
                        credentialsId: 'iic-google-client-id',
                        variable: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID'
                    )
                ]) {
                    sh '''
                        set -e

                        echo "Building frontend..."

                        cd frontend

                        export NEXT_PUBLIC_GOOGLE_CLIENT_ID

                        "$PNPM" build

                        echo "Frontend build completed."
                    '''
                }
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

                    echo "Backend deployment completed."
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

                    echo "Frontend deployment completed."
                '''
            }
        }

        stage('Frontend - Install Production Dependencies') {
            steps {
                sh '''
                    set -e

                    echo "Installing frontend production dependencies..."

                    cd "$FRONTEND_DIR"
                    "$PNPM" install --frozen-lockfile

                    echo "Frontend production dependencies installed."
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
                    echo "Backend health check passed."

                    echo "Checking frontend..."

                    for i in $(seq 1 10); do

                        if curl --fail --silent --show-error \
                            http://127.0.0.1:3000/ \
                            > /dev/null; then

                            echo "Frontend health check passed."
                            echo "All health checks passed."

                            exit 0
                        fi

                        echo "Frontend not ready yet. Attempt $i/10..."
                        sleep 2
                    done

                    echo "Frontend health check failed after 10 attempts."

                    exit 1
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