import nodemailer from 'nodemailer';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

// Create reusable transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendEmail = async ({ to, subject, html }: EmailOptions) => {
  try {
    const info = await transporter.sendMail({
      from: `"Melody AI" <${process.env.SMTP_FROM || 'noreply@melody-ai.com'}>`,
      to,
      subject,
      html,
    });

    console.log('Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Email send error:', error);
    throw error;
  }
};

export const sendPasswordResetEmail = async (email: string, resetUrl: string) => {
  return sendEmail({
    to: email,
    subject: 'Reset Your Melody AI Password',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; background-color: #0a0a0a; color: #ffffff; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; padding: 20px; }
          .header h1 { background: linear-gradient(to right, #a855f7, #3b82f6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          .content { background: #1a1a1a; padding: 30px; border-radius: 10px; }
          .button { display: inline-block; padding: 12px 24px; background: linear-gradient(to right, #a855f7, #3b82f6); color: white; text-decoration: none; border-radius: 6px; font-weight: bold; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Melody AI</h1>
          </div>
          <div class="content">
            <h2>Password Reset Request</h2>
            <p>We received a request to reset your password. Click the button below to create a new password:</p>
            <p style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" class="button">Reset Password</a>
            </p>
            <p>This link will expire in 1 hour.</p>
            <p>If you didn't request this, please ignore this email.</p>
            <p>Your password won't change until you create a new one.</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Melody AI. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  });
};

export const sendWelcomeEmail = async (email: string, name: string) => {
  return sendEmail({
    to: email,
    subject: 'Welcome to Melody AI!',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; background-color: #0a0a0a; color: #ffffff; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .content { background: #1a1a1a; padding: 30px; border-radius: 10px; text-align: center; }
          h1 { background: linear-gradient(to right, #a855f7, #3b82f6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          .button { display: inline-block; padding: 12px 24px; background: linear-gradient(to right, #a855f7, #3b82f6); color: white; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="content">
            <h1>Welcome to Melody AI! 🎵</h1>
            <p>Hi ${name},</p>
            <p>We're thrilled to have you on board! Start creating amazing music with AI.</p>
            <p>You have <strong>100 credits</strong> to start with.</p>
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/studio" class="button">Start Creating</a>
          </div>
        </div>
      </body>
      </html>
    `,
  });
};

export const sendResetPasswordEmail = async (
  email: string,
  resetUrl: string
) => {
  return sendPasswordResetEmail(email, resetUrl);
};
