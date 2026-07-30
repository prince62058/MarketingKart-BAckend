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
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "node.satyakabir@gmail.com",
        pass: "ucax pjqz npwg ywam",
      },
    });

    const info = {
      from: '"LeadKart" <node.satyakabir@gmail.com>',
      to: `${email}`, //"developerrudra@yahoo.com",
      subject: "Your One-Time Password (OTP)",
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LeadKart</title>
  <style>
   strong, a{
       color: rgb(0, 115, 128) !important;
    }
  </style>
</head>
<body style="margin: 0; padding: 0;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; border-spacing: 0; background-color: #f7f7f7;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; border-spacing: 0; background-color: #ffffff; border-radius: 10px; box-shadow: 0px 4px 6px rgba(0,0,0,0.3);">
          <tr>
            <td align="center" style="padding: 20px;">
              <img src="cid:emailImg" alt="otpImg" style="width: 100px; height: 100px; border-radius: 10px;">
              <h1 style="font-size: 24px; color: #007380; margin: 20px 0;">Email Confirmation</h1>
              <div style="font-size: 24px; margin: 20px 0;">
                <span style="border: 1px solid #b6b6b6; padding: 10px 20px; border-radius: 5px;">1</span>
                <span style="border: 1px solid #b6b6b6; padding: 10px 20px; border-radius: 5px;">2</span>
                <span style="border: 1px solid #b6b6b6; padding: 10px 20px; border-radius: 5px;">3</span>
                <span style="border: 1px solid #b6b6b6; padding: 10px 20px; border-radius: 5px;">4</span>
              </div>
              <p style="font-size: 16px; color: #000000;">We have sent an email to <strong style="color: #007380;">${email}</strong> to confirm the validity of your email address. After receiving the email, follow the link provided to complete your registration.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
      attachments: [
        {
          filename: "emailImg.webp",
          path: "https://leadkart.in-maa-1.linodeobjects.com/LEADKART/IMAGE/1753096394019_1660706448320.jpeg",
          cid: "emailImg", // same cid value as in the html img src
        },
      ],
    };

    try {
      let result = await transporter.sendMail(info);
      console.log("Email sent:", result);
    } catch (error) {
      console.error("Error sending email:", error);
    }
  }

  main();
};
