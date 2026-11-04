const service = require("../services/adContentService");
const { findOwnedBusiness } = require("../utils/ownedBusiness");
const responseBuilder = require("../utils/responseBuilder");
const { apiResponseStatusCode } = require("../Message/defaultMessage");

const refuse = (res, status, message) => res.status(status).json({ ...responseBuilder(apiResponseStatusCode[400], message), success: false });

exports.generate = async (req, res) => {
  const { businessId, adType, language, tone, hint } = req.body || {};
  if (!businessId) return refuse(res, 400, "Choose a business first.");
  if (!adType || typeof adType !== "string" || adType.length > 40) return refuse(res, 400, "Choose the type of ad first.");
  if (language !== undefined && !service.LANGUAGES[language]) return refuse(res, 400, "Choose Hinglish, Hindi or English.");
  if (hint !== undefined && (typeof hint !== "string" || hint.length > 500)) return refuse(res, 400, "Keep the note under 500 characters.");

  const found = await findOwnedBusiness(req.user, businessId, {
    select: "businessName tagline businessCategoryId servicesId cityId",
    populate: [
      { path: "businessCategoryId", select: "title" },
      { path: "servicesId", select: "title" },
      { path: "cityId", select: "name" },
    ],
  });
  if (!found) return refuse(res, 403, "That business is not on your account.");

  const business = {
    name: found.businessName || "",
    tagline: found.tagline || "",
    category: found.businessCategoryId && found.businessCategoryId.title,
    services: (found.servicesId || []).map(item => item && item.title).filter(Boolean).slice(0, 6),
    city: found.cityId && found.cityId.name,
  };

  try {
    const result = await service.generate({ userId: req.user._id, business, adType, language, tone, hint });
    return res.status(200).json(responseBuilder(apiResponseStatusCode[200], "Ad text ready", result));
  } catch (error) {
    if (!error.status) throw error;
    return refuse(res, error.status, error.message);
  }
};
