const http = require("http");
const nodemailer = require("nodemailer");

const otpLimits = {}; // In-memory store for OTP counts

const OTP_LIMIT = 5; // Max OTPs per hour
const OTP_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds

exports.sendOtp = (mobile, otp) => {
  const currentTime = Date.now();

  // Initialize the limit object for the mobile number if it doesn't exist
  if (!otpLimits[mobile]) {
    otpLimits[mobile] = { count: 0, firstSentTime: currentTime };
  }

  const { count, firstSentTime } = otpLimits[mobile];

  // Check if the current time is within the limit window
  if (currentTime - firstSentTime < OTP_WINDOW) {
    if (count >= OTP_LIMIT) {
      return false;
    }
  } else {
    // Reset the count and time if the window has passed
    otpLimits[mobile] = { count: 0, firstSentTime: currentTime };
  }

  // Send the OTP
  const options = {
    method: "POST",
    hostname: "api.msg91.com",
    port: null,
    path: "/api/v5/flow/",
    headers: {
      authkey: "384292AwWekgBJSf635f77feP1",
      "content-type": "application/json",
    },
  };

  const req = http.request(options, function (res) {
    const chunks = [];

    res.on("data", function (chunk) {
      chunks.push(chunk);
    });

    res.on("end", function () {
      const body = Buffer.concat(chunks);
      console.log(body.toString());
    });
  });

  req.write(
    `{\n  \"flow_id\": \"63614b3dabf10640e61fa856\",\n  \"sender\": \"DSMONL\",\n  \"mobiles\": \"91${mobile}\",\n  \"otp\": \"${otp}\"\n}`,
  );
  req.end();

  // Increment the count for the mobile number
  otpLimits[mobile].count++;
};

// exports.sendOtpInMail = (email, otp) => {
//   let emailImg = "emailImg.webp"
//   async function main() {
//     const transporter = nodemailer.createTransport({
//       service: "gmail",
//       auth: {
//         user: "node.satyakabir@gmail.com",
//         pass: "ucax pjqz npwg ywam",
//       },
//     });

//     // Generate a random OTP here
//     // const otp = generateOTP();

//     const info = {
//       from: '"LeadKart" <node.satyakabir@gmail.com>',
//       to: `${email}`, //"developerrudra@yahoo.com",
//       subject: "Your One-Time Password (OTP)",
//       html: `<!DOCTYPE html>
// <html lang="en">

// <head>
//   <meta charset="UTF-8">
//   <meta name="viewport" content="width=device-width, initial-scale=1.0">

//   <!-- Site Name -->
//   <title>LeadKart</title>

//   <!-- Site Icon -->
//   <!-- <link rel="icon" href="#"> -->

//   <style>

//     .container{
//       height: 100vh;
//       width: 100%;
//       display: flex;
//     }

//     .mainDiv{
//       background-color: white;
//       padding: 3rem;
//       border-radius: 1rem;
//       max-width: 35rem;
//       margin: auto;
//       box-shadow: -1px 1px 7px -1px #7f7979;
//     }

//     .otpImg{
//       width: 10rem;
//       height: 10rem;
//       border-radius: 1rem;
//     }

//     .otpDiv span{
//       font-size: 2rem;
//       border: 1px solid rgb(182, 182, 182);
//       padding: 0px 15px;
//       border-radius: 5px;
//     }

//     strong, a{
//       color: rgb(0, 115, 128) !important;
//     }
//   </style>
// </head>

// <body>

//  <div class="container">
//   <div class="mainDiv">
//     <div style="text-align: center;">
//       <img src="emailImg.webp" alt="otpImg" class="otpImg">
//       <h1>Email Confirmation</h1>
//       <div class="otpDiv">
//         <span>1</span>
//         <span>2</span>
//         <span>3</span>
//         <span>4</span>
//       </div>
//       <p>We have sent email to <strong style="color: rgb(0, 115, 128);">niteshchandora47@gmail.com</strong> to confirm the validity of our email address. After receicing the email follow the link provided to complete you registration.</p>
//     </div>
//  </div>
//  </div>

// </body>

// </html>`,
//     };

//     try {
//       let result = await transporter.sendMail(info);
//       console.log("Email sent:", result);
//     } catch (error) {
//       console.error("Error sending email:", error);
//     }
//   }

//   // Function to generate OTP
//   // function generateOTP() {
//   //   return Math.floor(100000 + Math.random() * 900000).toString();
//   // }
//   // Call the main function to send the email
//   main();
// };

exports.sendOtpInMail = (email, otp) => {
  async function main() {
    const user = process.env.EMAIL_USER || "ayotrix1@gmail.com";
    const pass = process.env.EMAIL_PASS || "ijewaofeggqbwmmm";

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user,
        pass,
      },
    });

    const otpDigits = String(otp).split("");

    const info = {
      from: `"MarketingKart.ai" <${user}>`,
      to: `${email}`,
      subject: `🔐 Your MarketingKart Verification Code: ${otp}`,
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MarketingKart.ai - Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #F8FAFC; padding: 30px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" style="width: 100%; max-width: 540px; border-collapse: collapse; background-color: #FFFFFF; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); overflow: hidden; border: 1px solid #E2E8F0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #FF6B00 0%, #FF8800 100%); padding: 35px 30px; text-align: center;">
              <h1 style="margin: 0; color: #FFFFFF; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">MarketingKart<span style="opacity: 0.9;">.ai</span></h1>
              <p style="margin: 6px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px; font-weight: 500;">AI-Powered Marketing & Lead Growth</p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px 35px 30px 35px; text-align: center;">
              <h2 style="margin: 0 0 12px 0; color: #0F172A; font-size: 20px; font-weight: 700;">Email Verification Code</h2>
              <p style="margin: 0 0 28px 0; color: #64748B; font-size: 14px; line-height: 22px;">
                We received a request to verify your email address for <strong style="color: #0F172A;">${email}</strong>. Use the One-Time Password (OTP) below to continue:
              </p>

              <!-- OTP Code Display -->
              <div style="margin: 30px 0; text-align: center;">
                <table role="presentation" style="margin: 0 auto; border-collapse: separate; border-spacing: 8px;">
                  <tr>
                    ${otpDigits
                      .map(
                        (digit) => `
                    <td style="width: 48px; height: 54px; background-color: #FFF7ED; border: 2px solid #FFEDD5; border-radius: 12px; text-align: center; vertical-align: middle;">
                      <span style="font-size: 26px; font-weight: 800; color: #EA580C; font-family: 'Courier New', Courier, monospace;">${digit}</span>
                    </td>`
                      )
                      .join("")}
                  </tr>
                </table>
              </div>

              <div style="background-color: #FEF3C7; border: 1px solid #FDE68A; border-radius: 12px; padding: 12px 16px; margin-top: 25px; text-align: left; display: inline-block;">
                <p style="margin: 0; color: #92400E; font-size: 12.5px; line-height: 18px;">
                  ⏱️ <strong>Note:</strong> This verification code is valid for <strong>10 minutes</strong>. Never share this OTP with anyone.
                </p>
              </div>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 35px;">
              <div style="height: 1px; background-color: #F1F5F9;"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 35px 30px 35px; text-align: center; background-color: #FAFAFA;">
              <p style="margin: 0 0 6px 0; color: #94A3B8; font-size: 12px;">
                If you did not request this email, please ignore it or contact support.
              </p>
              <p style="margin: 0; color: #64748B; font-size: 12px; font-weight: 600;">
                © ${new Date().getFullYear()} MarketingKart.ai — All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    };

    try {
      let result = await transporter.sendMail(info);
      console.log("OTP Email sent successfully:", result.messageId);
    } catch (error) {
      console.error("Error sending OTP email:", error.message);
    }
  }

  main();
};

