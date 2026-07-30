const axios = require("axios");
const SHA256 = require("crypto-js/sha256");
const { v4: uuidv4 } = require("uuid");


exports.PhonePayGateway = async (req, res) => {
  try {
    // Generate a unique ID
    const uniqueID = uuidv4();
    const { orderId, userId, amount, mobileNumber } = req.body;
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "orderId is required",
      });
    }
    if (!amount) {
      return res.status(400).json({
        success: false,
        message: "amount is required",
      });
    }
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }
    if (!mobileNumber) {
      return res.status(400).json({
        success: false,
        message: "mobileNumber is required",
      });
    }

    const payload = {
      merchantId: "PGTESTPAYUAT",
      merchantTransactionId: uniqueID,
      merchantUserId: "user" || userId,
      amount: amount * 100 || amount,
      redirectUrl: `https://essindiaonline.com/paymentstauspage`,
      redirectMode:"REDIRECT",
      callbackUrl: `https://server.leadkart.dsmacademy.in/api/PhonePayGatewayStatus?merchantTransactionId=${uniqueID}&orderId=${orderId}`, // Use the dynamically fetched callback URL
      mobileNumber: "8986576761" || mobileNumber,
      paymentInstrument: {
        type: process.env.PAYMENTINSTRUMENT_TYPE,
      },
    };
    // const payload = {
    //   merchantId: "PGTESTPAYUAT",
    //   merchantTransactionId: uniqueID,
    //   merchantUserId: userId,
    //   amount: amount * 100,
    //   redirectUrl: "https://essindiaonline.com/paymentstauspage",
    //   redirectMode: "REDIRECT",
    //   callbackUrl: `https://api.essindiaonline.com/api/PhonePayGatewayStatus?merchantTransactionId=${uniqueID}&orderId=${orderId}`,
    //   mobileNumber: mobileNumber,
    //   paymentInstrument: {
    //     type: "PAY_PAGE",
    //   },
    // };
    // console.log(payload);
    //  =================== Base64 ================== ||
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      "base64"
    );
    // console.log(encodedPayload);
    // ===================== SHA256 ===================== ||
    const hashedValue =
      SHA256(
        `${encodedPayload}/pg/v1/pay099eb0cd-02cf-4e2a-8aca-3e6c6aff0399`
      ) +
      "###" +
      1;
    // console.log(hashedValue, "hashedValue");
    // Set request headers and data
    const options = {
      method: "POST",
      // url: "https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay",
      url: "https://api.phonepe.com/apis/hermes/pg/v1/pay",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "X-VERIFY": hashedValue,
      },
      data: {
        request: encodedPayload,
      },
    };

    // Make the POST request to PhonePe
    const response = await axios(options);

    return res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    // console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.PhonePayGatewayStatus = async (req, res) => {
  const merchantTransactionId = req.query.merchantTransactionId;
  const merchantId = "PGTESTPAYUAT"; // Replace with your merchant ID
  const saltIndex = 1; // Replace with your salt index
  const checkStatus = async () => {
    try {
      const c =
        SHA256(
          `/pg/v1/status/${merchantId}/${merchantTransactionId}` +
            `${`09d82f66-8de2-4a23-8502-cbc4f1856030`}`
        ) + `###${saltIndex}`;
      const options = {
        method: "GET",
        url: `https://api.phonepe.com/apis/hermes/pg/v1/status/${merchantId}/${merchantTransactionId}`,
        // url: `https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/status/${merchantId}/${merchantTransactionId}`,
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
          "X-VERIFY": `${c}`,
          "X-MERCHANT-ID": merchantId,
        },
      };
      // const userModel = require("../models/userModel");

      const response = await axios.request(options);
      // console.log("ggg");
      if (response.data.status === "Pending") {
        // If payment status is still pending, schedule the next status check
        const currentTime = new Date().getTime();
        const elapsedTime = (currentTime - startTime) / 1000;

        if (elapsedTime < 25) {
          // First status check at 20-25 seconds
          setTimeout(checkStatus, 25 - elapsedTime * 1000);
        } else if (elapsedTime < 55) {
          // Every 3 seconds for the next 30 seconds
          setTimeout(checkStatus, 3000);
        } else if (elapsedTime < 115) {
          // Every 6 seconds for the next 60 seconds
          setTimeout(checkStatus, 6000);
        } else if (elapsedTime < 175) {
          // Every 10 seconds for the next 60 seconds
          setTimeout(checkStatus, 10000);
        } else if (elapsedTime < 235) {
          // Every 30 seconds for the next 60 seconds
          setTimeout(checkStatus, 30000);
        } else if (elapsedTime < 900) {
          // Every 1 minute until timeout (15 mins)
          setTimeout(checkStatus, 60000);
        } else {
          // Timeout reached, exit
          console.log(response.data);
          // return res
          //   .status(200)
          //   .json({ status: "Timeout", data: response.data });
        }
      }
      
    } catch (error) {
      return res.status(500).json({ status: "Error", message: error.message });
    }
  };
  const startTime = new Date().getTime();

  // Start the initial status check
  checkStatus();
};

exports.PhonePayGatewayCheckStatus = async (req, res) => {
  const merchantTransactionId = req.query.merchantTransactionId;
  if (!merchantTransactionId) {
    return res.status(400).json({
      success: false,
      message: "merchantTransactionId is required",
    });
  }
  const merchantId = "PGTESTPAYUAT"; // Replace with your merchant ID
  const saltIndex = 1; // Replace with your salt index
  try {
    const c =
      SHA256(
        `/pg/v1/status/${merchantId}/${merchantTransactionId}` +
          `${`09d82f66-8de2-4a23-8502-cbc4f1856030`}`
      ) + `###${saltIndex}`;
    const options = {
      method: "GET",
      url: `https://api.phonepe.com/apis/hermes/pg/v1/status/${merchantId}/${merchantTransactionId}`,
      // url: `https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/status/${merchantId}/${merchantTransactionId}`,
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "X-VERIFY": `${c}`,
        "X-MERCHANT-ID": merchantId,
      },
    };
    
    // const userModel = require("../models/userModel");

    const response = await axios.request(options);

    return res.status(200).json({ data: response.data });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};