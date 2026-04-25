<template>
  <div class="app-container">
    <el-card class="box-card">
      <template #header>
        <div class="card-header">
          <span>项目锁生成器</span>
        </div>
      </template>
      <el-form :model="form" label-width="120px">
        <el-form-item label="上传项目 (Zip)">
          <input type="file" @change="handleFileChange" accept=".zip" />
        </el-form-item>
        <el-form-item label="过期时间">
          <el-date-picker
            v-model="form.expireDate"
            type="datetime"
            placeholder="选择过期时间"
            value-format="YYYY-MM-DD HH:mm:ss"
          />
        </el-form-item>
        <el-form-item label="提示文案">
          <el-input v-model="form.message" type="textarea" placeholder="过期后展示给用户的提示文案" />
        </el-form-item>
        <el-form-item label="OpenAI API Key">
          <el-input v-model="form.apiKey" placeholder="用于解析项目的API Key (可选)" type="password" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="submitForm" :loading="loading">生成并下载</el-button>
        </el-form-item>
      </el-form>
      <el-divider content-position="left">过期页预览</el-divider>
      <div class="preview-wrapper">
        <div class="preview-expired-page">
          <h3>项目授权已到期</h3>
          <p>{{ previewMessage }}</p>
          <span>到期时间：{{ form.expireDate || '未设置' }}</span>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const form = reactive({
  expireDate: '',
  message: '该项目已到期，请联系开发者获取授权。',
  apiKey: ''
})

const file = ref(null)
const loading = ref(false)
const previewMessage = computed(() => form.message?.trim() || '项目已到期，请联系开发者续期。')

const handleFileChange = (e) => {
  if (e.target.files.length > 0) {
    file.value = e.target.files[0]
  }
}

const submitForm = async () => {
  if (!file.value) {
    ElMessage.error('请选择项目压缩包')
    return
  }
  if (!form.expireDate) {
    ElMessage.error('请选择过期时间')
    return
  }

  const formData = new FormData()
  formData.append('project', file.value)
  formData.append('expireDate', form.expireDate)
  formData.append('message', form.message)
  formData.append('apiKey', form.apiKey)

  loading.value = true
  try {
    const response = await axios.post('http://localhost:3000/api/lock', formData, {
      responseType: 'blob'
    })
    
    // Download the file
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `locked_${file.value.name}`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    ElMessage.success('处理成功！')
  } catch (error) {
    console.error(error)
    ElMessage.error('处理失败，请检查控制台或后端日志')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.app-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background-color: #f5f7fa;
}
.box-card {
  width: 640px;
}
.preview-wrapper {
  background: #0f172a;
  border-radius: 10px;
  padding: 18px;
}
.preview-expired-page {
  border: 1px solid #334155;
  border-radius: 12px;
  background: #111827;
  color: #e2e8f0;
  padding: 22px;
}
.preview-expired-page h3 {
  margin: 0 0 10px;
  font-size: 22px;
}
.preview-expired-page p {
  margin: 0 0 12px;
  line-height: 1.8;
  white-space: pre-wrap;
}
.preview-expired-page span {
  color: #94a3b8;
  font-size: 13px;
}
</style>
