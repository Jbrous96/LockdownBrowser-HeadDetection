let model, webcam, maxPredictions, tracking = false;
const lookAtTarget = { x: 0, y: 0, z: 0 };
const front = { x: -20, y: 2, z: 0 };

class LockdownBrowser {
  constructor() {
    this.warningCount = 0;
    this.maxWarnings = 3;
    this.isFullscreen = false;
    this.lastFaceDetectionTime = Date.now();
    this.faceCheckInterval = 2000;
    this.violations = [];
    this.examStartTime = null;
    this.examDuration = null;
    this.studentInfo = null;
    this.proctorConnection = null;
    this.headRotationHistory = [];
    this.rotationLogs = [];
  }

  async initialize(examDuration, studentData, proctorWebsocket = null) {
    this.proctorConnection = proctorWebsocket;
    this.examDuration = examDuration;
    this.studentInfo = studentData;
    this.examStartTime = Date.now();
    const URL = "/models/teachable-machine-model/";
    const modelURL = URL + "model.json";
    const metadataURL = URL + "metadata.json";
    model = await tmPose.load(modelURL, metadataURL);
    maxPredictions = model.getTotalClasses();

    const size = 200;
    const flip = true;
    webcam = new tmPose.Webcam(size, size, flip);
    await webcam.setup();
    await webcam.play();

    this.setupSecurityListeners();
    this.enterFullscreen();
    this.startFaceTracking();
    this.initializeActivityMonitoring();
  }

  async startFaceTracking() {
    tracking = true;
    this.headRotationHistory = [];
    this.lastHeadCheck = Date.now();
    
    this.faceTrackingInterval = setInterval(async () => {
      if (!tracking) return;

      const { pose, posenetOutput } = await model.estimatePose(webcam.canvas);
      const prediction = await model.predict(posenetOutput);
      
      // Track head rotation
      if (pose && pose.keypoints) {
        const nose = pose.keypoints.find(k => k.part === 'nose');
        const leftEar = pose.keypoints.find(k => k.part === 'leftEar');
        const rightEar = pose.keypoints.find(k => k.part === 'rightEar');
        
        if (nose && leftEar && rightEar) {
          // Calculate horizontal angle
          const earDiff = rightEar.position.x - leftEar.position.x;
          const noseDiff = nose.position.x - (leftEar.position.x + rightEar.position.x) / 2;
          const horizontalAngle = Math.atan2(noseDiff, earDiff) * (180 / Math.PI);
          
          // Calculate vertical angle
          const verticalDiff = nose.position.y - (leftEar.position.y + rightEar.position.y) / 2;
          const verticalAngle = Math.atan2(verticalDiff, earDiff) * (180 / Math.PI);
          
          const now = Date.now();
          
          // Check if head is turned beyond threshold
          if (Math.abs(horizontalAngle) > 60) {
            this.headRotationHistory.push({
              startTime: now,
              horizontalAngle,
              verticalAngle
            });
          } else if (this.headRotationHistory.length > 0) {
            const lastRotation = this.headRotationHistory[this.headRotationHistory.length - 1];
            const duration = (now - lastRotation.startTime) / 1000;
            
            if (duration > 2.1) {
              await this.logHeadRotation({
                timestamp: new Date(lastRotation.startTime).toISOString(),
                duration,
                horizontalAngle: lastRotation.horizontalAngle,
                verticalAngle: lastRotation.verticalAngle
              });
              
              // Alert proctor if available
              if (this.proctorConnection) {
                this.alertProctor({
                  type: 'head_rotation',
                  studentId: this.studentInfo.id,
                  timestamp: new Date(lastRotation.startTime).toISOString(),
                  duration,
                  angles: {
                    horizontal: lastRotation.horizontalAngle,
                    vertical: lastRotation.verticalAngle
                  }
                });
              }
            }
            this.headRotationHistory = [];
          }
        }
      }

      let faceDetected = false;
      for (const pred of prediction) {
        if (pred.probability > 0.9) {
          faceDetected = true;
          this.lastFaceDetectionTime = Date.now();
          break;
        }
      }

      if (!faceDetected) {
        const timeSinceLastDetection = Date.now() - this.lastFaceDetectionTime;
        if (timeSinceLastDetection > 3000) {
          this.handleSecurityViolation('Face not detected');
        }
      }

      this.updateCameraView(prediction);
    }, this.faceCheckInterval);
  }

  setupSecurityListeners() {
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) {
        this.handleSecurityViolation('Fullscreen mode exited');
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.handleSecurityViolation('Browser tab switched');
      }
    });

    document.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('keydown', (e) => {
      if (
        (e.altKey && e.key === 'Tab') ||
        (e.ctrlKey && e.shiftKey && e.key === 'Escape') ||
        e.key === 'Meta' ||
        (e.ctrlKey && ['c', 'v', 'x'].includes(e.key.toLowerCase()))
      ) {
        e.preventDefault();
        this.handleSecurityViolation('Restricted keyboard shortcut used');
      }
    });
  }

  initializeActivityMonitoring() {
    let lastMouseActivity = Date.now();
    document.addEventListener('mousemove', () => {
      lastMouseActivity = Date.now();
    });

    setInterval(() => {
      const inactiveTime = Date.now() - lastMouseActivity;
      if (inactiveTime > 30000) {
        this.handleSecurityViolation('Prolonged inactivity detected');
      }
    }, 5000);

    this.examTimer = setInterval(() => {
      const timeRemaining = this.examDuration - (Date.now() - this.examStartTime);
      if (timeRemaining <= 0) {
        this.endExam();
      } else {
        this.updateTimerDisplay(timeRemaining);
      }
    }, 1000);
  }

  async logHeadRotation(rotationData) {
    this.rotationLogs.push(rotationData);
    
    try {
      await fetch('/api/log-head-rotation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...rotationData,
          studentId: this.studentInfo.id,
          examId: this.examId
        })
      });
    } catch (error) {
      console.error('Failed to log head rotation:', error);
    }
  }

  alertProctor(alertData) {
    if (this.proctorConnection && this.proctorConnection.readyState === WebSocket.OPEN) {
      this.proctorConnection.send(JSON.stringify(alertData));
    }
  }

  handleSecurityViolation(reason) {
    this.warningCount++;
    this.violations.push({
      timestamp: new Date().toISOString(),
      reason: reason,
      studentId: this.studentInfo?.id
    });

    this.showWarning(`Security violation detected: ${reason}`);

    if (this.warningCount >= this.maxWarnings) {
      this.endExam('Security violations exceeded maximum limit');
    }

    this.logViolation(reason);
  }

  async logViolation(reason) {
    try {
      await fetch('/api/log-violation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          reason: reason,
          studentInfo: this.studentInfo,
          examId: this.examId
        })
      });
    } catch (error) {
      console.error('Failed to log violation:', error);
    }
  }

  showWarning(message) {
    const warningElement = document.createElement('div');
    warningElement.className = 'warning-message';
    warningElement.textContent = message;
    document.body.appendChild(warningElement);

    setTimeout(() => {
      warningElement.remove();
    }, 3000);
  }

  updateTimerDisplay(timeRemaining) {
    const minutes = Math.floor(timeRemaining / 60000);
    const seconds = Math.floor((timeRemaining % 60000) / 1000);
    document.getElementById('timer').textContent = 
      `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  async enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
      this.isFullscreen = true;
    } catch (error) {
      this.handleSecurityViolation('Failed to enter fullscreen mode');
    }
  }

  updateCameraView(prediction) {
    if (prediction[0].probability > 0.9) {
      gsap.to(lookAtTarget, {
        x: front.x,
        y: front.y,
        z: front.z,
        duration: 3,
        onUpdate: function () {
          camera.lookAt(lookAtTarget.x, lookAtTarget.y, lookAtTarget.z);
        },
      });
    }
  }

  async endExam(reason = 'Exam completed') {
    clearInterval(this.faceTrackingInterval);
    clearInterval(this.examTimer);
    tracking = false;

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }

    if (webcam) {
      await webcam.stop();
    }

    this.saveExamResults(reason);
    this.showExamComplete(reason);
  }

  async saveExamResults(reason) {
    const examData = {
      studentInfo: this.studentInfo,
      headRotationLogs: this.rotationLogs,
      examDuration: this.examDuration,
      actualDuration: Date.now() - this.examStartTime,
      violations: this.violations,
      endReason: reason,
      timestamp: new Date().toISOString()
    };

    try {
      await fetch('/api/save-exam-results', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(examData)
      });
    } catch (error) {
      console.error('Failed to save exam results:', error);
    }
  }

  showExamComplete(reason) {
    const completionScreen = document.createElement('div');
    completionScreen.className = 'exam-completion-screen';
    completionScreen.innerHTML = `
      <h2>Exam Completed</h2>
      <p>Reason: ${reason}</p>
      <p>Total violations: ${this.violations.length}</p>
    `;
    document.body.appendChild(completionScreen);
  }
}

const styles = document.createElement('style');
styles.textContent = `
  .warning-message {
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background-color: #ff4444;
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    z-index: 1000;
    animation: fadeIn 0.3s ease-in-out;
  }

  .exam-completion-screen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(255, 255, 255, 0.9);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translate(-50%, -20px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
`;
document.head.appendChild(styles);

// Initialize lockdown browser
const lockdownBrowser = new LockdownBrowser();
lockdownBrowser.initialize(3600000, { // 1 hour exam
  id: 'student123',
  name: 'Test Student',
  examId: 'exam001'
});
