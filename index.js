// const nodemailer = require("nodemailer");
// const express = require("express");
// const rateLimit = require("express-rate-limit");

import nodemailer from "nodemailer";
import express from "express";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import fs from "fs";
import handlebars from "handlebars";
import { dirname } from "path";
import { fileURLToPath } from "url";
import cors from "cors";

const config = JSON.parse(fs.readFileSync("config.json"));
const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config();

const clientIP = (req) => {
	return (
		req.headers["cf-connecting-ip"] ||
		req.headers["x-client-ip"] ||
		req.headers["x-real-ip"] ||
		req.headers["x-forwarded-for"] ||
		req.socket.remoteAddress
	);
};

const readHTMLFile = (path, callback) => {
	fs.readFile(path, { encoding: "utf-8" }, function (err, html) {
		if (err) {
			callback(err);
		} else {
			callback(null, html);
		}
	});
};

const checkEmail = async (email) => {
	let params = new URLSearchParams();
	params.append("email", email);
	params.append("json", "true");
	try {
		const response = await fetch(`https://api.stopforumspam.org/api?${params.toString()}`);
		const data = await response.json();

		if (!data.success) {
			if (data.email.error) {
				throw new Error(`Error checking email ${email} with stopforumspam. Error: ${data.email.error}`);
			}
			throw new Error(`Error checking email ${email} with stopforumspam. Response: ${data}`);
		} else {
			return [data.email, null];
		}
	} catch (error) {
		return [null, error.message];
	}
};

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());

const { EMAIL_HOST: host, EMAIL_USERNAME: user, EMAIL_PASSWORD: password, EMAIL_PORT: emailPort, EMAIL_SSL: secure } = process.env;

const emailConfig = {
	port: parseInt(emailPort),
	secureConnection: secure === "true",
	host,
	auth: {
		user,
		pass: password,
	},
};

const transporter = nodemailer.createTransport(emailConfig);

transporter.verify().then((success) => {
	if (success) {
		console.log("Email Login Successful");
	}
});

if (config.rateLimiter.enabled) {
	const { windowInMins, max, standardHeaders, legacyHeaders } = config.rateLimiter.config;

	const limiter = rateLimit({
		windowMs: windowInMins * 60 * 1000,
		max,
		standardHeaders,
		legacyHeaders,
		keyGenerator: (request, response) => clientIP(request),
	});

	app.use("/", limiter);
}

const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
	res.redirect("https://github.com/JackBailey/SimpleContact");
});

app.post("/", (req, res) => {
	const referer = req.header("Referer");
	const errors = {};

	console.log(`${clientIP(req)} | has requested to send an email`);

	const recipient = config.email.accounts.find((account) => {
		if (req.query.user) {
			return account.user == req.query.user;
		} else {
			return account.default;
		}
	});

	if (!recipient) {
		if (req.query.user) {
			errors.user = "user was not found";
		} else {
			errors.user = "default user not provided in config";
		}
	}

	["name", "email", "message"].forEach((condition) => {
		if (!req.body[condition]) errors[condition] = `${condition} was not provided.`;
	});

	if (Object.keys(errors).length !== 0)
		return res.status(400).json({
			errors,
		});

	const { name, email: userEmail } = req.body;
	let { message } = req.body;

	readHTMLFile(__dirname + "/templates/email.html", async function (err, html) {
		if (err) {
			console.log("error reading file", err);
			return;
		}

		const template = handlebars.compile(html);
		
		let footer = "";
		
		if (config.enableStopForumSpam) {
			let checkEmailResponse = await checkEmail(userEmail);
			
			if (checkEmailResponse[1]) {
				console.log(checkEmailResponse[1]);
				return res.status(500).json({
					success: false,
					errors: {
						server: "There was an error checking your message, please try again later",
					}
				});
			}
			
			footer += `\n<hr>\n<a href="https://www.stopforumspam.com/search?q=${encodeURI(userEmail)}">Spam results</a>: ${checkEmailResponse[0].frequency}${checkEmailResponse[0].confidence ? "<br>Confidence: " + checkEmailResponse[0].confidence + "%" : ""}`;
		}
		
		const htmlToSend = template({
			name,
			email: userEmail,
			message,
			referer: referer ? ` ${referer}` : "",
			footer,
		});

		const email = {
			from: `${name} <${process.env.EMAIL_SENDER}>`,
			to: `${recipient.name} <${recipient.email}>`,
			subject: `New email received from ${name}`,
			replyTo: userEmail,
			html: htmlToSend,
		};

		console.log(`${clientIP(req)} | has sent an email from ${userEmail} to ${recipient.email}`);

		transporter.sendMail(email, function (error) {
			if (error) {
				return res.status(500).json({
					success: false,
					errors: {
						server: "there was an error sending the email",
					},
				});
			} else {
				return res.status(200).json({
					success: true,
					message: "email sent",
				});
			}
		});
	});
});

app.listen(port, () => {
	console.log(`Listening on ${port}`);
});
