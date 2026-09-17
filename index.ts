import { Hono } from "hono";

const app = new Hono()


app.get("/", (c) => {
    return c.redirect("https://github.com/shellhaki",302)
})

app.get("/github", (c) => {
    return c.redirect("https://github.com/shellhaki",302)
})

app.get("/linkedin", (c) => {
    return c.redirect("https://www.linkedin.com/in/excel-maxwell-b0739a312?utm_source=share_via&utm_content=profile&utm_medium=member_ios",302)
})

app.get("/x", (c) => {
    return c.redirect("https://x.com/shellhaki",302)
})

app.get("/twitter", (c) => {
    return c.redirect("https://x.com/shellhaki",302)
})

app.get("/whatsapp", (c) => {
    return c.redirect("https://wa.me/2349112171078",302)
})

app.get("/whatsapp2", (c) => {
    return c.redirect("https://wa.me/shellhakii",302)
})

app.get("/telegram", (c) => {
    return c.redirect("https://t.me/shellhakii",302)
})

app.get("/health", (c) => {
    return c.json({
        status: "ok"
    },200)
})