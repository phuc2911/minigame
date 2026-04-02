// ─── CẤU HÌNH CHƯƠNG TRÌNH ─────────────────────────────────
// Chỉnh sửa file này để thay đổi tên, slogan, logo — chỉ cần đổi 1 lần!
const APP_CONFIG = {
  eventEmoji: "💕",
  eventTitle: 'Minigame - Ngày hội "Non sông thống nhất"',
  orgName: "Viettel Network",
  slogan: "Một kết nối - Triệu trái tim hướng về ngày độc lập!",
  subtext:
    "Kỷ niệm 51 năm Ngày Giải phóng miền Nam, thống nhất đất nước (30/4/1975 - 30/4/2026) và 140 năm Ngày Quốc tế Lao động (1/5/1886 - 1/5/2026)!",
  logo: "images/Viettel Networks-white.png",
  logoAlt: "Viettel Network",
  // Thời gian bắt đầu sự kiện — định dạng: "YYYY-MM-DDTHH:MM:SS"
  // Đặt null hoặc xóa dòng này để luôn hiển thị nút tham gia
  eventStartTime: "2026-04-02T08:00:00",
};

// Gọi hàm này sau khi DOM sẵn sàng để điền tự động vào các phần tử có data-cfg-*
function applyAppConfig(cfg) {
  cfg = cfg || APP_CONFIG;
  document.querySelectorAll('[data-cfg="event"]').forEach((el) => {
    el.textContent = cfg.eventEmoji + cfg.eventTitle + cfg.eventEmoji;
  });
  document.querySelectorAll('[data-cfg="org"]').forEach((el) => {
    el.textContent = cfg.orgName;
  });
  document.querySelectorAll('[data-cfg="slogan"]').forEach((el) => {
    el.textContent = cfg.slogan;
  });
  document.querySelectorAll('[data-cfg="subtext"]').forEach((el) => {
    el.textContent = cfg.subtext;
  });
  document.querySelectorAll('[data-cfg="logo"]').forEach((el) => {
    el.src = cfg.logo;
    el.alt = cfg.logoAlt;
  });
  // Cập nhật <title> trang
  if (document.title) {
    document.title = document.title.replace("__ORG__", cfg.orgName);
  }
  // // Tự động chèn tên event vào giữa mọi .navbar chưa có .navbar-title
  // document.querySelectorAll('.navbar:not([data-no-title])').forEach(nav => {
  //   if (nav.querySelector('.navbar-title')) return; // đã có rồi thì bỏ qua
  //   const span = document.createElement('span');
  //   span.className = 'navbar-title';
  //   span.textContent = cfg.eventEmoji + ' ' + cfg.eventTitle + ' ' + cfg.eventEmoji;
  //   nav.appendChild(span);
  // });
}

// Xóa "phiên đăng nhập" dùng cho cả host/play/index.
// Lý do: nút "Thoát" trên host/play sẽ đưa về index, nhưng nếu không xóa
// localStorage thì index sẽ tự load lại account cũ.
const EMP_STORAGE_KEY = "vn_employee";
function clearEmployeeSession() {
  try {
    localStorage.removeItem(EMP_STORAGE_KEY);
  } catch {
    // Nếu trình duyệt chặn localStorage thì bỏ qua.
  }
}
